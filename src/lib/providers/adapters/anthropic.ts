/**
 * Anthropic Messages API streaming adapter (claude-*).
 * Docs: https://docs.anthropic.com/en/api/messages
 */
import type { CoreMessage, Part, ProxyChatRequest, StreamEvent, ToolSpec } from '@/lib/types';
import { readSSE, extractApiError, hostOf } from '@/lib/providers/sse';
import { joinUrl } from '@/lib/providers/adapters/openai-compat';

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: { type: string; media_type: string; data: string };
}

function toAnthropicMessages(messages: CoreMessage[]) {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // passed separately
    const blocks: AnthropicBlock[] = [];
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'tool_result') {
          blocks.push({ type: 'tool_result', tool_use_id: p.toolCallId, content: p.content } as unknown as AnthropicBlock);
        }
      }
      if (!blocks.length) continue;
      out.push({ role: 'user', content: blocks });
      continue;
    }
    for (const p of m.parts) {
      if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
      else if (p.type === 'image')
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: p.mimeType, data: p.data },
        } as unknown as AnthropicBlock);
      else if (p.type === 'tool_call')
        blocks.push({ type: 'tool_use', id: p.id, name: p.name, input: safeJson(p.args) } as unknown as AnthropicBlock);
    }
    if (!blocks.length) continue;
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks });
  }
  // Anthropic requires alternating user/assistant; merge consecutive same-role.
  const merged: typeof out = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content.push(...m.content);
    else merged.push(m);
  }
  return merged;
}

function toAnthropicTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return typeof v === 'object' && v !== null ? v : { value: v };
  } catch {
    return { _raw: s };
  }
}

export async function* streamAnthropic(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .flatMap((m) => m.parts)
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature,
    stream: true,
    messages: toAnthropicMessages(req.messages),
  };
  if (system) body.system = system;
  if (req.tools?.length) body.tools = toAnthropicTools(req.tools);

  let res: Response;
  try {
    res = await fetch(joinUrl(req.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    yield { type: 'error', message: `اتصال به Anthropic برقرار نشد: ${e?.message ?? e}` };
    return;
  }

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    yield { type: 'error', message: extractApiError(payload, res.status, hostOf(req.baseUrl)) };
    return;
  }

  for await (const evt of readSSE(res.body, req.signal)) {
    let json: any;
    try {
      json = JSON.parse(evt.data);
    } catch {
      continue;
    }
    switch (json.type) {
      case 'content_block_start': {
        const b = json.content_block;
        if (b?.type === 'tool_use') yield { type: 'tool_call_start', id: b.id, name: b.name };
        break;
      }
      case 'content_block_delta': {
        const d = json.delta;
        if (d?.type === 'text_delta' && d.text) yield { type: 'text', delta: d.text };
        else if (d?.type === 'input_json_delta' && d.partial_json)
          yield { type: 'tool_call_delta', id: '', argsDelta: d.partial_json };
        else if (d?.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', delta: d.thinking };
        break;
      }
      case 'message_delta': {
        const reason = json.delta?.stop_reason;
        if (reason) yield { type: 'finish', reason: reason === 'tool_use' ? 'tool_calls' : reason };
        break;
      }
      case 'error': {
        yield { type: 'error', message: extractApiError(json, json?.error?.status ?? 500, hostOf(req.baseUrl)) };
        return;
      }
      case 'message_stop':
        return;
    }
  }
}

export async function listAnthropicModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(joinUrl(baseUrl, '/v1/models'), {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    signal,
  });
  if (!res.ok) throw new Error(extractApiError(await res.json().catch(() => null), res.status, hostOf(baseUrl)));
  const json = await res.json();
  return ((json.data ?? []) as any[]).map((m) => m.id).filter(Boolean).sort();
}

export async function testAnthropicKey(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(joinUrl(baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      signal,
    });
    if (res.ok) return { ok: true, message: 'کلید معتبر است و مدل پاسخ داد ✅' };
    return { ok: false, message: extractApiError(await res.json().catch(() => null), res.status, hostOf(baseUrl)) };
  } catch (e: any) {
    return { ok: false, message: `اتصال برقرار نشد: ${e?.message ?? e}` };
  }
}
