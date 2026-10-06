import { NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { verifyCapability } from '@/lib/server/capability';

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
 * Host allow/deny policy.
 *
 * The app is self-hosted and single-user, and the built-in MCP server plus
 * local LLM tools (Ollama, LM Studio) genuinely live on loopback, so this is a
 * documented allowance rather than a blanket block: loopback IS reachable.
 *
 * What is always blocked on a *public* deployment:
 *  - cloud metadata endpoints (instance credentials)
 *  - link-local / RFC1918 private ranges and CGNAT, which on a cloud host are
 *    the internal services the attacker cannot otherwise reach
 *  - IPv6 loopback and unspecified
 *
 * `HOOSHIYAR_ALLOW_PRIVATE_MCP=1` restores the old permissive behaviour for
 * self-hosters who run MCP servers on a private LAN.
 */
function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^[[\]]/g, '');
  if (h === 'metadata.google.internal' || h === '169.254.169.254') return true;
  if (process.env.HOOSHIYAR_ALLOW_PRIVATE_MCP === '1') {
    // Only the hard blocks remain; loopback/LAN stays reachable.
    return false;
  }
  if (h === '::' || h === '::1') return true;
  if (h === 'localhost' || h === 'localhost.localdomain' || h === '0.0.0.0') return false;
  // IPv4 literal?
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true; // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local
    if (a >= 224) return true; // multicast / reserved
    return false; // public IPv4 (includes 127/8 loopback, allowed by design)
  }
  // IPv6 literal: block anything that is not a global unicast address.
  if (h.includes(':')) {
    return !(/^2[0-9a-f]{3}:/.test(h)); // only 2000::/3 is allowed
  }
  // Hostname: block the obvious internal suffixes; anything else is public.
  return /\.(local|internal|localhost)$/i.test(h);
}

export async function POST(req: NextRequest) {
  const cap = await verifyCapability(req);
  if (cap !== true) return Response.json({ error: cap }, { status: 403 });

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
