import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bootstrap — issues the capability token the dangerous tool routes
 * require (see lib/server/capability.ts).
 *
 * Next 16 only lets `cookies()` be *modified* inside a Server Action or Route
 * Handler, so the root layout cannot set it while rendering the page. The
 * client calls this endpoint once on boot; it returns the token for the page's
 * own use and sets the HttpOnly, SameSite=Strict cookie the server compares
 * against on later requests.
 *
 * The token is not a secret in the usual sense: it exists to prove a request
 * originated from this app's own UI. A third-party page cannot read the
 * cookie, and cannot call this endpoint usefully because the response is
 * protected by SameSite on the fetch it would need to make.
 */
export async function GET() {
  const store = await cookies();
  const existing = store.get('hooshiyar.cap')?.value;
  if (!existing || existing.length < 32) {
    const { randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('base64url');
    store.set('hooshiyar.cap', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return Response.json({ ok: true, token });
  }
  return Response.json({ ok: true, token: existing });
}
