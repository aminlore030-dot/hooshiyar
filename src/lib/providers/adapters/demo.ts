/**
 * «دموی داخلی» provider — a zero-config demo engine for trying the app before
 * adding your own key. Fully optional: the app is BYOK-first and works without
 * this route entirely.
 *
 * The backend is resolved by `lib/server/demo-backend.ts` from environment
 * variables only, so no secret ever lives in the repo. When nothing is
 * configured the demo is simply reported as unavailable and the UI hides it.
 *
 * OpenAI-compatible backends stream natively; the legacy z-ai SDK is
 * non-streaming, so we pseudo-stream by chunking the full answer. Tool calling
 * is supported on both paths (OpenAI-style tool_calls).
 */
import type { ProxyChatRequest, StreamEvent } from '@/lib/types';
import { toOpenAiMessages, joinUrl } from '@/lib/providers/adapters/openai-compat';
import { readSSE, extractApiError } from '@/lib/providers/sse';
import { activeDemoBackend, type DemoBackend } from '@/lib/server/demo-backend';

export async function* streamDemo(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  const backend = activeDemoBackend();
  if (!backend) {
    yield {
      type: 'error',
      message: 'موتور دمو روی این سرور فعال نیست. لطفاً با کلید خودتان (BYOK) یکی از ارائه‌دهنده‌ها را تنظیم کنید.',
    };
    return;
  }

  if (backend.openaiCompatible) {
    yield* streamOpenAiCompatibleDemo(req, backend);
    return;
  }

  yield* streamLegacyZai(req, backend);
}

/* ------------------------- OpenAI-compatible path ------------------------- */

async function* streamOpenAiCompatibleDemo(
  req: ProxyChatRequest,
  backend: DemoBackend,
): AsyncGenerator<StreamEvent> {
  const url = joinUrl(backend.baseUrl, '/chat/completions');
  const payload: Record<string, unknown> = {
    model: backend.model,
    messages: toOpenAiMessages(req.messages),
    stream: true,
  };
  if (req.temperature != null) payload.temperature = req.temperature;
  if (req.maxTokens) payload.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    payload.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${backend.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: req.signal ?? AbortSignal.timeout(180_000),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    yield { type: 'error', message: `موتور دمو در دسترس نیست: ${String(e?.message ?? e).slice(0, 200)}` };
    return;
  }

  if (!res.ok || !res.body) {
    let detail = 'خطای موتور دمو';
    try {
      const payload = await res.json();
      detail = extractApiError(payload, res.status, backend.baseUrl);
    } catch {
      /* keep the generic message */
    }
    yield { type: 'error', message: detail };
    return;
  }

  for await (const part of readSSE(res.body)) {
    const data = part.data?.trim();
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') return;
      continue;
    }
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = json?.choices?.[0];
    const delta = choice?.delta;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text', delta: delta.content };
    }
    const calls = delta.tool_calls;
    if (Array.isArray(calls)) {
      for (const tc of calls) {
        const id = tc?.id ?? `demo_call_${Date.now()}`;
        if (tc?.function?.name) {
          yield { type: 'tool_call_start', id, name: tc.function.name };
        }
        if (tc?.function?.arguments) {
          yield { type: 'tool_call_delta', id, argsDelta: tc.function.arguments };
        }
      }
    }

    const finish = choice?.finish_reason;
    if (finish) {
      yield { type: 'finish', reason: finish };
      return;
    }
  }

  // Some providers close the stream without an explicit finish_reason chunk.
  yield { type: 'finish', reason: 'stop' };
}

/* ----------------------------- legacy z-ai path ----------------------------- */

async function* streamLegacyZai(
  req: ProxyChatRequest,
  backend: DemoBackend,
): AsyncGenerator<StreamEvent> {
  let ZAI: any;
  try {
    const mod = await import('z-ai-web-dev-sdk');
    ZAI = mod.default ?? mod;
  } catch {
    yield { type: 'error', message: 'موتور دمو روی این سرور نصب نیست.' };
    return;
  }

  // The upstream demo engine does not accept images or tool messages as-is.
  const wire: { role: string; content: string }[] = [];
  for (const m of toOpenAiMessages(req.messages) as Record<string, any>[]) {
    if (m.role === 'tool') {
      wire.push({
        role: 'user',
        content: `[نتیجه ابزار ${m.tool_call_id ?? ''}] ${String(m.content ?? '').slice(0, 8000)}`,
      });
      continue;
    }
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
    }
    if (content === null) content = '';
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        content += `\n[درخواست ابزار: ${tc.function.name} با آرگومان‌های ${tc.function.arguments}]`;
      }
    }
    wire.push({ role: m.role === 'system' ? 'assistant' : m.role, content: String(content) });
  }

  const payload: Record<string, unknown> = {
    model: backend.model,
    messages: wire,
    thinking: { type: 'disabled' },
  };
  if (req.tools?.length) {
    payload.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  let result: any;
  try {
    const zai = new ZAI({ baseUrl: backend.baseUrl, apiKey: backend.apiKey });
    result = await zai.chat.completions.create(payload as any);
  } catch (e: any) {
    yield { type: 'error', message: `خطای موتور دمو: ${String(e?.message ?? e).slice(0, 200)}` };
    return;
  }

  const msg = result?.choices?.[0]?.message;
  const text: string = msg?.content ?? '';
  const toolCalls: { id?: string; function: { name: string; arguments?: string } }[] = msg?.tool_calls ?? [];

  // Pseudo-stream so the UI behaves identically to real providers.
  const CHUNK = 24;
  const DELAY = 12;
  for (let i = 0; i < text.length; i += CHUNK) {
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    yield { type: 'text', delta: text.slice(i, i + CHUNK) };
    await new Promise((r) => setTimeout(r, DELAY));
  }

  for (const [i, tc] of toolCalls.entries()) {
    const id = tc.id ?? `demo_call_${i}_${Date.now()}`;
    yield { type: 'tool_call_start', id, name: tc.function.name };
    yield { type: 'tool_call_delta', id, argsDelta: tc.function.arguments ?? '{}' };
  }

  yield { type: 'finish', reason: toolCalls.length ? 'tool_calls' : 'stop' };
}
