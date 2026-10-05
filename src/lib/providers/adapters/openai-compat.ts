/**
 * OpenAI-compatible streaming adapter.
 * Covers OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, Fireworks,
 * Ollama, LM Studio and any custom /v1/chat/completions endpoint.
 */
import type {
  CoreMessage,
  Part,
  ProxyChatRequest,
  StreamEvent,
  ToolSpec,
} from '@/lib/types';
import { readSSE, extractApiError, hostOf } from '@/lib/providers/sse';

/* --------------------------- request conversion --------------------------- */

type OaiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function toOpenAiMessages(messages: CoreMessage[]) {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.parts.filter((p) => p.type === 'text').map((p) => (p as any).text).join('\n') });
      continue;
    }
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: p.toolCallId, content: p.content });
        }
      }
      continue;
    }
    if (m.role === 'user') {
      const parts: OaiContentPart[] = [];
      for (const p of m.parts) {
        if (p.type === 'text') parts.push({ type: 'text', text: p.text });
        else if (p.type === 'image')
          parts.push({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } });
      }
      out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
      continue;
    }
    // assistant
    const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as any).text).join('');
    const toolCalls = m.parts
      .filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call')
      .map((p) => ({
        id: p.id,
        type: 'function',
        function: { name: p.name, arguments: p.args },
      }));
    const msg: Record<string, unknown> = { role: 'assistant', content: text || null };
    if (toolCalls.length) msg.tool_calls = toolCalls;
    out.push(msg);
  }
  return out;
}

function toOpenAiTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/* ------------------------------- streaming -------------------------------- */

export async function* streamOpenAiCompatible(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  const url = joinUrl(req.baseUrl, '/chat/completions');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.apiKey) headers['Authorization'] = `Bearer ${req.apiKey}`;
  if (req.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://hooshiyar.local';
    headers['X-Title'] = 'Hooshiyar AI Workspace';
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAiMessages(req.messages),
    stream: true,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
  };
  if (req.tools?.length) body.tools = toOpenAiTools(req.tools);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    yield { type: 'error', message: `اتصال به «${req.baseUrl}» برقرار نشد: ${e?.message ?? e}` };
    return;
  }

  if (!res.ok || !res.body) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = await res.text().catch(() => null);
    }
    yield { type: 'error', message: extractApiError(payload, res.status, hostOf(req.baseUrl)) };
    return;
  }

  // Accumulators for streamed tool calls.
  const tcIndex = new Map<number, { id: string; name: string; args: string }>();

  for await (const evt of readSSE(res.body, req.signal)) {
    if (evt.data === '[DONE]') break;
    let json: any;
    try {
      json = JSON.parse(evt.data);
    } catch {
      continue;
    }
    if (json.error) {
      yield { type: 'error', message: extractApiError(json, 500, hostOf(req.baseUrl)) };
      return;
    }
    const choice = json.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text', delta: delta.content };
    } else if (Array.isArray(delta.content)) {
      for (const c of delta.content) if (c?.type === 'text' && c.text) yield { type: 'text', delta: c.text };
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      yield { type: 'reasoning', delta: delta.reasoning_content };
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        let acc = tcIndex.get(idx);
        if (!acc) {
          acc = { id: tc.id ?? `call_${idx}_${Date.now()}`, name: '', args: '' };
          tcIndex.set(idx, acc);
        }
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) {
          acc.name += tc.function.name;
          yield { type: 'tool_call_start', id: acc.id, name: acc.name };
        }
        if (tc.function?.arguments) {
          acc.args += tc.function.arguments;
          yield { type: 'tool_call_delta', id: acc.id, argsDelta: tc.function.arguments };
        }
      }
    }

    if (choice.finish_reason) {
      yield { type: 'finish', reason: choice.finish_reason };
    }
  }
}

/* ---------------------------- auxiliary calls ------------------------------ */

export async function listOpenAiModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(joinUrl(baseUrl, '/models'), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (!res.ok) throw new Error(extractApiError(await res.json().catch(() => null), res.status, hostOf(baseUrl)));
  const json = await res.json();
  const models = (json.data ?? json.models ?? []) as any[];
  return models.map((m) => m.id ?? m.name).filter(Boolean).sort();
}

export async function testOpenAiKey(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        stream: false,
      }),
      signal,
    });
    if (res.ok) return { ok: true, message: 'کلید معتبر است و مدل پاسخ داد ✅' };
    return { ok: false, message: extractApiError(await res.json().catch(() => null), res.status, hostOf(baseUrl)) };
  } catch (e: any) {
    return { ok: false, message: `اتصال برقرار نشد: ${e?.message ?? e}` };
  }
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  if (b.endsWith(path)) return b; // user already included the path
  return b + path;
}
