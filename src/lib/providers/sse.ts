/**
 * Minimal, dependency-free SSE (Server-Sent Events) reader for fetch Response bodies.
 * Handles multi-line data, CR/LF, comment lines, and [DONE] sentinels.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + (buffer[sep] === '\r' ? 4 : 2));
        const parsed = parseEvent(raw);
        if (parsed) yield parsed;
      }
    }
    const tail = parseEvent(buffer);
    if (tail) yield tail;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

function parseEvent(raw: string): { event?: string; data: string } | null {
  if (!raw.trim() || raw.startsWith(':')) return null;
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

/** Extract a readable Persian-friendly error message from a provider error payload. */
export function extractApiError(payload: unknown, status: number): string {
  const p = payload as Record<string, any> | undefined;
  const msg =
    p?.error?.message ??
    p?.error ??
    p?.message ??
    p?.[0]?.error?.message ??
    (typeof payload === 'string' ? payload.slice(0, 300) : null);
  const fa: Record<number, string> = {
    401: 'کلید API نامعتبر است (خطای ۴۰۱)',
    403: 'دسترسی با این کلید مجاز نیست (خطای ۴۰۳)',
    404: 'آدرس یا مدل پیدا نشد (خطای ۴۰۴)',
    429: 'محدودیت نرخ درخواست؛ کمی بعد دوباره تلاش کنید (خطای ۴۲۹)',
    500: 'خطای سرور ارائه‌دهنده (۵۰۰)',
    502: 'خطای دروازه ارائه‌دهنده (۵۰۲)',
    503: 'سرویس ارائه‌دهنده در دسترس نیست (۵۰۳)',
  };
  const base = fa[status] ?? `خطای HTTP ${status}`;
  return msg ? `${base}: ${String(msg).slice(0, 300)}` : base;
}
