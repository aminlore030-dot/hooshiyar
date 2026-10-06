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

const DDG_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const BING_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

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

  // Fallback chain for hosts where the SDK has no credentials (i.e. any
  // deployment other than the original one) — see /api/demo-status.
  // 1) DuckDuckGo HTML (blocked from some cloud egress IPs, so keep trying).
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': DDG_UA,
        'Accept-Language': 'fa,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const results = parseDdg(await res.text()).slice(0, num);
      if (results.length) return Response.json({ engine: 'duckduckgo', results });
    }
  } catch {
    /* try the next engine */
  }

  // 2) Bing — different egress reputation, parses with a stable CSS class.
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${num * 2}&setlang=fa`, {
      headers: {
        'User-Agent': BING_UA,
        'Accept-Language': 'fa,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const results = parseBing(await res.text()).slice(0, num);
      if (results.length) return Response.json({ engine: 'bing', results });
    }
  } catch {
    /* engines exhausted */
  }

  return Response.json({ error: 'جستجو ناموفق بود: هیچ موتور جستجویی پاسخ نداد.' }, { status: 502 });
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

/* --------------------------------- Bing ---------------------------------- */

/**
 * Bing result links are wrapped in a tracking redirect
 * (`bing.com/ck/a?…&u=a1<base64-of-real-url>&ntb=1`). We unwrap `u` so the
 * caller sees the real destination; if decoding fails we keep the raw href.
 */
function unwrapBingUrl(href: string): string {
  // The href comes straight out of raw HTML, where `&` is escaped as `&amp;`.
  const decoded = href.replace(/&amp;/g, '&');
  const m = /[?&]u=([^&]+)/.exec(decoded);
  if (!m) return decoded;
  try {
    const b64 = decodeURIComponent(m[1]).replace(/^[a-z]\d/, '');
    const url = Buffer.from(b64, 'base64').toString('utf-8');
    return /^https?:\/\//i.test(url) ? url : decoded;
  } catch {
    return decoded;
  }
}

/** Bing: `<li class="b_algo">…<h2 class=""><a href="…">title</a></h2>…<p>snippet</p>…` */
function parseBing(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const itemRe = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) && out.length < 10) {
    const url = unwrapBingUrl(m[1]);
    if (!/^https?:\/\//i.test(url)) continue; // skip Bing's internal links
    out.push({
      title: stripTags(m[2]).slice(0, 200),
      url,
      snippet: snippetNear(html, m.index).slice(0, 600),
      host: safeHost(url),
    });
  }
  return out;
}

/** Grab the text block that follows a result link (Bing puts the snippet in a <p>). */
function snippetNear(html: string, index: number): string {
  const tail = html.slice(index, index + 4000);
  const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(tail);
  return p ? stripTags(p[1]) : '';
}
