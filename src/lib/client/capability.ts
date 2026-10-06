'use client';

/**
 * Client side of the capability token (see lib/server/capability.ts).
 *
 * The /api/bootstrap route sets an HttpOnly, SameSite=Strict `hooshiyar.cap`
 * cookie and returns the same value in the response body. Client JS cannot
 * read the cookie, so the value from the response is kept in memory and echoed
 * in the `x-hooshiyar-cap` header on dangerous tool calls. The server compares
 * that header to the cookie.
 *
 * A page on another origin cannot read our cookie, and cannot obtain the token
 * from /api/bootstrap either (SameSite=Strict blocks credentialed cross-origin
 * reads), so it cannot forge the header.
 */

const HEADER_NAME = 'x-hooshiyar-cap';
const BOOTSTRAP_URL = '/api/bootstrap';

let cached: string | null | undefined;

export const CAPABILITY_HEADER = HEADER_NAME;

/** The token, or null until bootstrap has run. */
export function capabilityToken(): string | null {
  return cached ?? null;
}

/**
 * Fetch the token from the server. Idempotent — the result is cached. Call
 * this early in the app's boot sequence (before any tool can be used).
 */
export async function ensureCapability(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(BOOTSTRAP_URL, { credentials: 'same-origin' });
    if (!res.ok) {
      cached = null;
      return null;
    }
    const json = (await res.json()) as { token?: string };
    cached = typeof json.token === 'string' && json.token.length >= 16 ? json.token : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Header pair to spread into a fetch() call to a dangerous route. */
export function capabilityHeaders(): Record<string, string> {
  const token = capabilityToken();
  return token ? { [HEADER_NAME]: token } : {};
}
