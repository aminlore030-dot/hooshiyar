'use client';

/**
 * Browser-side client for the /api/chat proxy.
 * Consumes the proxy's uniform SSE (StreamEvent JSON lines) and yields
 * the same StreamEvent contract the server adapters emit.
 */
import type { ProxyChatRequest, StreamEvent } from '@/lib/types';

export async function* proxyStream(
  req: Omit<ProxyChatRequest, 'signal'> & { signal?: AbortSignal },
): AsyncGenerator<StreamEvent> {
  const { signal, ...payload } = req;
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    yield { type: 'error', message: `خطای شبکه در ارتباط با سرور: ${e?.message ?? e}` };
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `خطای سرور پروکسی (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.error ?? msg;
    } catch {
      /* keep default */
    }
    if (res.status === 429) msg = 'محدودیت نرخ درخواست روی سرور؛ کمی صبر کنید و دوباره تلاش کنید.';
    yield { type: 'error', message: msg };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        /* skip malformed */
      }
    }
  }
}
