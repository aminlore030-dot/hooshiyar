/**
 * Google Gemini streaming adapter (generativelanguage.googleapis.com).
 * Uses the REST v1beta API with ?alt=sse streaming.
 */
import type { CoreMessage, Part, ProxyChatRequest, StreamEvent, ToolSpec } from '@/lib/types';
import { readSSE, extractApiError } from '@/lib/providers/sse';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

function toGeminiContents(messages: CoreMessage[]) {
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // systemInstruction separately
    const parts: GeminiPart[] = [];
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: p.name,
              response: { result: p.content.slice(0, 24000) },
            },
          });
        }
      }
      if (!parts.length) continue;
      contents.push({ role: 'user', parts }); // function responses are sent as user turn
      continue;
    }
    for (const p of m.parts as Part[]) {
      if (p.type === 'text' && p.text) parts.push({ text: p.text });
      else if (p.type === 'image')
        parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
      else if (p.type === 'tool_call')
        parts.push({ functionCall: { name: p.name, args: safeJson(p.args) } });
    }
    if (!parts.length) continue;
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

function toGeminiTools(tools: ToolSpec[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: cleanSchema(t.parameters),
      })),
    },
  ];
}

/** Gemini rejects some JSON-Schema keywords — strip the risky ones. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['additionalProperties', '$schema', 'default'].includes(k)) continue;
    if (k === 'properties' && typeof v === 'object' && v !== null) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [
          pk,
          typeof pv === 'object' && pv !== null ? cleanSchema(pv as Record<string, unknown>) : pv,
        ]),
      );
    } else if (k === 'items' && typeof v === 'object' && v !== null) {
      out[k] = cleanSchema(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return typeof v === 'object' && v !== null ? v : { value: v };
  } catch {
    return { _raw: s };
  }
}

export async function* streamGemini(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .flatMap((m) => m.parts)
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');

  const body: Record<string, unknown> = {
    contents: toGeminiContents(req.messages),
    generationConfig: {
      temperature: req.temperature,
      maxOutputTokens: req.maxTokens,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.tools?.length) body.tools = toGeminiTools(req.tools);

  const url = `${req.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    yield { type: 'error', message: `اتصال به Gemini برقرار نشد: ${e?.message ?? e}` };
    return;
  }

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    yield { type: 'error', message: extractApiError(payload, res.status) };
    return;
  }

  for await (const evt of readSSE(res.body, req.signal)) {
    let json: any;
    try {
      json = JSON.parse(evt.data);
    } catch {
      continue;
    }
    if (json.error) {
      yield { type: 'error', message: extractApiError(json, json.error.code ?? 500) };
      return;
    }
    const cand = json.candidates?.[0];
    const parts: GeminiPart[] = cand?.content?.parts ?? [];
    for (const p of parts) {
      if (p.text) yield { type: 'text', delta: p.text };
      if (p.functionCall) {
        const id = `gem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        yield { type: 'tool_call_start', id, name: p.functionCall.name };
        yield { type: 'tool_call_delta', id, argsDelta: JSON.stringify(p.functionCall.args ?? {}) };
      }
    }
    if (cand?.finishReason) yield { type: 'finish', reason: cand.finishReason };
  }
}

export async function listGeminiModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models?key=${encodeURIComponent(apiKey)}`, { signal });
  if (!res.ok) throw new Error(extractApiError(await res.json().catch(() => null), res.status));
  const json = await res.json();
  return ((json.models ?? []) as any[])
    .map((m) => String(m.name ?? '').replace(/^models\//, ''))
    .filter((n: string) => n && !n.includes('embedding') && !n.includes('aqa'))
    .sort();
}

export async function testGeminiKey(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      signal,
    });
    if (res.ok) return { ok: true, message: 'کلید معتبر است و مدل پاسخ داد ✅' };
    return { ok: false, message: extractApiError(await res.json().catch(() => null), res.status) };
  } catch (e: any) {
    return { ok: false, message: `اتصال برقرار نشد: ${e?.message ?? e}` };
  }
}
