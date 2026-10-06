import { NextRequest } from 'next/server';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { activeDemoBackend } from '@/lib/server/demo-backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/demo-status — reports whether the built-in demo engine is actually
 * usable on THIS host.
 *
 * The original demo engine (`z-ai-web-dev-sdk`) only works on the project's own
 * hosting, where a credentials file exists. Everywhere else the SDK installs
 * but has nothing to talk to. Rather than failing mid-chat, the UI probes this
 * endpoint and shows the demo card as unavailable.
 *
 * A backend is only reported as available once it has actually answered a
 * request, so a misconfigured key never surfaces as a working demo.
 */
let cached: { available: boolean; checkedAt: number } | null = null;

export async function GET(req: NextRequest) {
  const rl = rateLimit(`demo-status:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ available: cached?.available ?? false, cached: true }, { status: 429 });

  // Re-probe at most once per 5 minutes per server instance.
  if (cached && Date.now() - cached.checkedAt < 5 * 60_000) {
    return Response.json({ available: cached.available, cached: true });
  }

  const backend = activeDemoBackend();
  let available = false;
  if (backend) {
    available = await probeBackend(backend);
  }

  cached = { available, checkedAt: Date.now() };
  return Response.json({ available, cached: false });
}

/**
 * Send a trivial chat request and only accept the backend as working when it
 * returns a 2xx status. Keeps a bad key or a dead host from being advertised.
 */
async function probeBackend(backend: ReturnType<typeof activeDemoBackend>): Promise<boolean> {
  if (!backend) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${backend.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${backend.apiKey}`,
      },
      body: JSON.stringify({
        model: backend.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
