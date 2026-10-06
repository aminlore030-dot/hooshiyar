/**
 * «دموی داخلی» provider — backed by the host server's built-in LLM
 * (z-ai-web-dev-sdk). Requires no user key and is fully optional: the app is
 * BYOK-first and works without this route entirely.
 *
 * The upstream SDK is non-streaming, so we pseudo-stream by chunking the full
 * answer; tool calling IS supported upstream (OpenAI-style), so the demo
 * provider can exercise the complete agent loop.
 */
import type { CoreMessage, ProxyChatRequest, StreamEvent } from '@/lib/types';
import { toOpenAiMessages } from '@/lib/providers/adapters/openai-compat';

export async function* streamDemo(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  let ZAI: any;
  try {
    const mod = await import('z-ai-web-dev-sdk');
    ZAI = mod.default ?? mod;
  } catch (e: any) {
    yield { type: 'error', message: 'موتور دمو روی این سرور نصب نیست. لطفاً یکی از ارائه‌دهندگان را با کلید خودتان تنظیم کنید.' };
    return;
  }

  let zai: any;
  try {
    // Same env-var fallback as /api/demo-status: the SDK's own config file
    // lookup fails off the original host.
    const baseUrl = process.env.ZAI_BASE_URL;
    const apiKey = process.env.ZAI_API_KEY;
    zai = baseUrl && apiKey ? new ZAI({ baseUrl, apiKey }) : await ZAI.create();
  } catch (e: any) {
    yield { type: 'error', message: `راه‌اندازی موتور دمو ناموفق بود: ${e?.message ?? e}` };
    return;
  }

  // Convert to OpenAI-style wire messages (text parts only; the upstream
  // demo engine does not accept images).
  const wire: { role: string; content: string }[] = [];
  for (const m of toOpenAiMessages(req.messages) as Record<string, any>[]) {
    if (m.role === 'tool') {
      // Upstream demo accepts tool results as plain context lines.
      wire.push({ role: 'user', content: `[نتیجه ابزار ${m.tool_call_id ?? ''}] ${String(m.content ?? '').slice(0, 8000)}` });
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
    result = await zai.chat.completions.create(payload as any);
  } catch (e: any) {
    yield { type: 'error', message: `خطای موتور دمو: ${e?.message ?? e}` };
    return;
  }

  const msg = result?.choices?.[0]?.message;
  const text: string = msg?.content ?? '';
  const toolCalls: { id?: string; function: { name: string; arguments?: string } }[] = msg?.tool_calls ?? [];

  // Pseudo-stream the text so the UI behaves identically to real providers.
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
