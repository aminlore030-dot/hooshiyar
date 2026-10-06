import 'server-only';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

/**
 * Per-session CSRF-style capability token for the *dangerous* tool routes.
 *
 * Problem this solves: the app is BYOK and intentionally has NO user accounts,
 * yet `/api/tools/shell`, `/api/tools/py`, `/api/tools/js`, `/api/files`,
 * `/api/upload` and `/api/mcp-proxy` execute code or relay requests from the
 * server. Without a server-verifiable proof that the call came from this app's
 * own UI, anyone who learns the URL gets remote code execution on the host
 * (verified: a bare curl ran `whoami` and returned the machine account).
 *
 * Design:
 *  - The root layout (a server component) issues a random token in a
 *    SameSite=Strict, HttpOnly, Secure cookie when the page is first served,
 *    and mirrors the same value into a <meta> tag the page can read.
 *  - The client echoes the meta value in the `x-hooshiyar-cap` header on every
 *    dangerous call; the route compares it to the cookie.
 *  - An attacker on another site cannot read a SameSite=Strict, HttpOnly
 *    cookie, so they cannot forge the header; a same-site attacker who could
 *    read the meta tag could replay it, which is why this is a baseline gate
 *    rather than the only control.
 *
 * This is deliberately lightweight (no accounts, no DB) and matches the app's
 * stateless, local-first philosophy. It is NOT a substitute for running these
 * tools inside a container — self-hosters who want full isolation should use
 * the Docker deployment.
 */

const COOKIE_NAME = 'hooshiyar.cap';
const HEADER_NAME = 'x-hooshiyar-cap';

/** Read the cookie on the server side (never exposed to client JS). */
export async function capabilityCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value;
}

/**
 * Verify a dangerous-route request: the caller's header must match the
 * server-issued cookie. Returns a Persian error message when it fails.
 */
export async function verifyCapability(req: NextRequest): Promise<true | string> {
  const presented = req.headers.get(HEADER_NAME);
  const expected = await capabilityCookie();
  if (!expected) {
    return 'سرور هنوز نشست کاربری صادر نکرده است — صفحه را دوباره بارگذاری کنید.';
  }
  if (!presented || !timingSafeEqual(presented, expected)) {
    return 'درخواست از سمت این برنامه نیست (نشست نامعتبر). صفحه را بازخوانی و دوباره تلاش کنید.';
  }
  return true;
}

export const CAPABILITY_HEADER = HEADER_NAME;

/* --------------------------------- helpers --------------------------------- */

async function makeToken(): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return randomBytes(32).toString('base64url');
}

/** Constant-time string comparison to avoid timing leaks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
