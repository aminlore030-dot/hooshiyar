import { NextRequest } from 'next/server';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { verifyCapability } from '@/lib/server/capability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/upload — extract plain text from an uploaded file for RAG.
 * Supports: text/*, markdown, code files, JSON, CSV; PDFs via unpdf.
 * The file content is returned to the browser which chunks + indexes it
 * into IndexedDB (local-first; nothing is stored on the server).
 */
const MAX_SIZE = 15 * 1024 * 1024; // 15MB

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sql', 'html', 'css', 'xml', 'log',
]);

export async function POST(req: NextRequest) {
  const cap = await verifyCapability(req);
  if (cap !== true) return Response.json({ error: cap }, { status: 403 });

  const rl = rateLimit(`upload:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ بارگذاری' }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'فرم بارگذاری نامعتبر است.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'فایلی پیوست نشده است.' }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: 'حجم فایل بیش از ۱۵ مگابایت است.' }, { status: 413 });

  const name = file.name || 'فایل';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  try {
    if (ext === 'pdf' || file.type === 'application/pdf') {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = (Array.isArray(text) ? text.join('\n\n') : text) ?? '';
      const clean = merged.replace(/\s{4,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!clean) return Response.json({ error: 'متن PDF قابل استخراج نبود (شاید تصویری باشد).' }, { status: 422 });
      return Response.json({ name, mime: 'application/pdf', text: clean, chars: clean.length });
    }

    if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/') || file.type === 'application/json') {
      const text = await file.text();
      return Response.json({ name, mime: file.type || 'text/plain', text, chars: text.length });
    }

    return Response.json(
      { error: 'قالب پشتیبانی نمی‌شود. قالب‌های مجاز: متن، مارک‌داون، کد، JSON، CSV و PDF.' },
      { status: 415 },
    );
  } catch (e: any) {
    return Response.json({ error: `استخراج متن ناموفق بود: ${String(e?.message ?? e).slice(0, 200)}` }, { status: 500 });
  }
}
