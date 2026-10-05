import { NextRequest } from 'next/server';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tools/fetch — fetch a URL and extract readable text.
 * Server-side execution avoids CORS and keeps the page in plain text for the model.
 */
const bodySchema = z.object({
  url: z.string().url().max(2000),
  maxChars: z.number().int().min(500).max(30_000).default(12_000),
});

/** SSRF guard: block private/loopback targets. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '0.0.0.0' || h === '169.254.169.254') return true;
  if (h === '::1' || h === '[::1]') return true;
  return false;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`fetch:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ درخواست' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'آدرس نامعتبر است.' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(parsed.data.url);
  } catch {
    return Response.json({ error: 'آدرس URL نامعتبر است.' }, { status: 400 });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return Response.json({ error: 'فقط http و https مجاز است.' }, { status: 400 });
  }
  if (isBlockedHost(target.hostname)) {
    return Response.json({ error: 'دسترسی به آدرس‌های داخلی مجاز نیست.' }, { status: 403 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HooshiyarBot/1.0; +https://hooshiyar.local)',
        'Accept-Language': 'fa,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return Response.json({ error: `سرور مقصد کد ${res.status} برگرداند.` }, { status: 502 });

    const contentType = res.headers.get('content-type') ?? '';
    let text = '';
    if (contentType.includes('html') || contentType.includes('xml') || contentType === '') {
      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, noscript, svg, iframe, nav, footer, header, form, aside').remove();
      const title = $('title').first().text().trim() || target.hostname;
      const main = $('article').first().length
        ? $('article').first()
        : $('main').first().length
          ? $('main').first()
          : $('body');
      const body = main
        .find('h1,h2,h3,p,li,pre,td,blockquote')
        .map((_i, el) => $(el).text().trim())
        .get()
        .filter((t) => t.length > 2)
        .join('\n');
      text = `# ${title}\n\n${body}`;
    } else if (contentType.includes('json')) {
      text = JSON.stringify(await res.json(), null, 2);
    } else {
      text = await res.text();
    }

    text = text.replace(/\n{3,}/g, '\n\n').trim().slice(0, parsed.data.maxChars);
    if (!text) return Response.json({ error: 'محتوای متنی قابل استخراج یافت نشد.' }, { status: 422 });
    return Response.json({ url: target.toString(), contentType, text });
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'زمان دریافت به پایان رسید.' : String(e?.message ?? e);
    return Response.json({ error: `دریافت صفحه ناموفق بود: ${msg.slice(0, 200)}` }, { status: 502 });
  }
}
