import { NextRequest } from 'next/server';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/demo-status — reports whether the built-in demo engine
 * (z-ai-web-dev-sdk) is actually usable on THIS host.
 *
 * On the original hosting environment the SDK ships with host credentials and
 * works with zero configuration. On generic hosts (Vercel, Netlify, self-host)
 * the package may install but `ZAI.create()` fails — the UI uses this probe to
 * present the demo as unavailable instead of failing mid-chat.
 */
let cached: { available: boolean; checkedAt: number } | null = null;

export async function GET(req: NextRequest) {
  const rl = rateLimit(`demo-status:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ available: cached?.available ?? false, cached: true }, { status: 429 });

  // Re-probe at most once per 5 minutes per server instance.
  if (cached && Date.now() - cached.checkedAt < 5 * 60_000) {
    return Response.json({ available: cached.available, cached: true });
  }

  let available = false;
  try {
    const mod = await import('z-ai-web-dev-sdk');
    const ZAI: any = (mod as any).default ?? mod;

    // The SDK looks for a `.z-ai-config` file in cwd/home/etc. That file does
    // not exist on Vercel (and would be a secret in the repo if it did), so
    // fall back to env vars and construct the client directly. On the original
    // host the file exists and ZAI.create() works on its own.
    const baseUrl = process.env.ZAI_BASE_URL;
    const apiKey = process.env.ZAI_API_KEY;
    const zai = baseUrl && apiKey
      ? new ZAI({ baseUrl, apiKey })
      : await Promise.race([
          ZAI.create(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
    available = Boolean(zai?.chat?.completions?.create);
  } catch {
    available = false;
  }

  cached = { available, checkedAt: Date.now() };
  return Response.json({ available, cached: false });
}
