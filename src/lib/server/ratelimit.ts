import 'server-only';

/**
 * Simple in-memory token-bucket rate limiter (per-IP, per-route).
 * For single-user self-hosted deployments this is sufficient; a multi-tenant
 * deployment should swap in Redis or a durable store.
 */

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window size in ms. */
  windowMs: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: opts.limit, last: now };
    buckets.set(key, b);
  }
  const elapsed = now - b.last;
  b.last = now;
  b.tokens = Math.min(opts.limit, b.tokens + (elapsed / opts.windowMs) * opts.limit);
  if (b.tokens < 1) {
    return { ok: false, retryAfterMs: Math.ceil(((1 - b.tokens) * opts.windowMs) / opts.limit) };
  }
  b.tokens -= 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now - v.last > 10 * opts.windowMs) buckets.delete(k);
  }
  return { ok: true, retryAfterMs: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}
