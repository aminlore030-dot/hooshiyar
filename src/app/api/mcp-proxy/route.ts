import { NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mcp-proxy — CORS-free JSON-RPC bridge to user-configured MCP
 * servers (Model Context Protocol, Streamable HTTP transport).
 * The browser posts {url, payload}; the server relays it verbatim and returns
 * the JSON-RPC response. No URLs are cached; requests are validated.
 */
const bodySchema = z.object({
  url: z.string().url().max(1000),
  payload: z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(200), z.number()]),
    method: z.string().min(1).max(200),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
});

/**
 * Host allow/deny policy (documented assumption): this app is self-hosted and
 * single-user, so loopback targets are intentionally allowed — that is how the
 * built-in MCP server (port 3010) and local tools (Ollama-style) are reached.
 * Cloud metadata + link-local are always blocked.
 */
function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === '0.0.0.0' ||
    h === '169.254.169.254' ||
    h === 'metadata.google.internal' ||
    h === '::'
  );
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`mcp:${clientIp(req)}`, { limit: 90, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ درخواست MCP' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'درخواست MCP نامعتبر است.' }, { status: 400 });
  const { url, payload } = parsed.data;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Response.json({ error: 'آدرس سرور MCP نامعتبر است.' }, { status: 400 });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return Response.json({ error: 'فقط http/https پشتیبانی می‌شود.' }, { status: 400 });
  }
  if (blockedHost(target.hostname)) {
    return Response.json({ error: 'دسترسی به این میزبان مجاز نیست.' }, { status: 403 });
  }

  try {
    const res = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      // Streamable HTTP may answer with SSE; extract the first JSON-RPC data frame.
      const text = await res.text();
      const match = /data:\s*(\{[\s\S]*?\})\s*\n/.exec(text);
      if (match) {
        return new Response(match[1], { headers: { 'Content-Type': 'application/json' } });
      }
      return Response.json({ error: 'پاسخ SSE نامعتبر از سرور MCP.' }, { status: 502 });
    }

    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'زمان پاسخ سرور MCP به پایان رسید.' : String(e?.message ?? e);
    return Response.json({ error: `ارتباط با سرور MCP ناموفق بود: ${msg.slice(0, 200)}` }, { status: 502 });
  }
}
