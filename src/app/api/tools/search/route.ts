import { NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tools/search — agent web search.
 * Primary: host search function (no key needed, available on this deployment).
 * Fallback: DuckDuckGo HTML lite (best-effort, may be blocked on some hosts).
 */
const bodySchema = z.object({
  query: z.string().min(1).max(400),
  num: z.number().int().min(1).max(10).default(6),
  recencyDays: z.number().int().min(1).max(365).optional(),
});

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  host: string;
  date?: string;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`search:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ جستجو' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'پارامترهای جستجو نامعتبر است.' }, { status: 400 });
  const { query, num, recencyDays } = parsed.data;

  // Primary path: built-in host search.
  try {
    const mod = await import('z-ai-web-dev-sdk');
    const ZAI = mod.default ?? mod;
    const zai = await ZAI.create();
    const args: { query: string; num: number; recency_days?: number } = { query, num };
    if (recencyDays) args.recency_days = recencyDays;
    const raw = (await zai.functions.invoke('web_search', args)) as any[];
    const results: SearchResult[] = (raw ?? []).slice(0, num).map((r) => ({
      title: String(r?.name ?? r?.title ?? '').slice(0, 200),
      url: String(r?.url ?? ''),
      snippet: String(r?.snippet ?? '').slice(0, 600),
      host: String(r?.host_name ?? new URL(String(r?.url ?? 'https://x.invalid'), 'https://x.invalid').host ?? ''),
      date: r?.date ? String(r.date) : undefined,
    }));
    if (results.length) {
      return Response.json({ engine: 'host', results });
    }
  } catch {
    /* fall through to DDG */
  }

  // Fallback: DuckDuckGo HTML (best effort).
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
        'Accept-Language': 'fa,en;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`DDG ${res.status}`);
    const html = await res.text();
    const results = parseDdg(html).slice(0, num);
    if (!results.length) return Response.json({ error: 'هیچ نتیجه‌ای یافت نشد.' }, { status: 404 });
    return Response.json({ engine: 'duckduckgo', results });
  } catch (e: any) {
    return Response.json({ error: `جستجو ناموفق بود: ${String(e?.message ?? e).slice(0, 200)}` }, { status: 502 });
  }
}

function parseDdg(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]));
  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html))) {
    let url = lm[1];
    const uddg = /uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    out.push({
      title: stripTags(lm[2]).slice(0, 200),
      url,
      snippet: (snippets[i] ?? '').slice(0, 600),
      host: safeHost(url),
    });
    i++;
    if (out.length >= 10) break;
  }
  return out;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}
