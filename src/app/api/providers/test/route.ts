import { NextRequest } from 'next/server';
import { z } from 'zod';
import { testOpenAiKey, testAnthropicKey, testGeminiKey } from '@/lib/providers';
import { activeDemoBackend } from '@/lib/server/demo-backend';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/providers/test — verify a stored key actually works before the
 * user relies on it, and show them a readable Persian result.
 *
 * The key travels per-request and is never logged or persisted.
 */
const bodySchema = z.object({
  provider: z.string().min(1),
  baseUrl: z.string().max(500).default(''),
  apiKey: z.string().max(2000).default(''),
  model: z.string().max(200).default(''),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(`test:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ ok: false, message: 'محدودیت نرخ درخواست' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: 'درخواست نامعتبر است.' }, { status: 400 });

  const { provider, baseUrl, apiKey, model } = parsed.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    switch (provider) {
      case 'anthropic': {
        const base = baseUrl || 'https://api.anthropic.com';
        if (!model) return Response.json({ ok: false, message: 'نام مدل را وارد کنید.' });
        const r = await testAnthropicKey(base, apiKey, model, controller.signal);
        return Response.json(r);
      }
      case 'gemini': {
        const base = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        if (!model) return Response.json({ ok: false, message: 'نام مدل را وارد کنید.' });
        const r = await testGeminiKey(base, apiKey, model, controller.signal);
        return Response.json(r);
      }
      case 'hooshiyar-demo': {
        // The demo backend is validated by a live probe in /api/demo-status;
        // here we just confirm it is configured at all.
        const backend = activeDemoBackend();
        if (!backend) {
          return Response.json({ ok: false, message: 'موتور دمو روی این سرور فعال نیست.' });
        }
        return Response.json({ ok: true, message: 'موتور دمو پیکربندی شده است ✅' });
      }
      default: {
        if (!baseUrl) return Response.json({ ok: false, message: 'آدرس پایه را وارد کنید.' });
        if (!model) return Response.json({ ok: false, message: 'نام مدل را وارد کنید.' });
        const r = await testOpenAiKey(baseUrl, apiKey, model, controller.signal);
        return Response.json(r);
      }
    }
  } catch (e: any) {
    return Response.json({ ok: false, message: `اتصال برقرار نشد: ${String(e?.message ?? e).slice(0, 300)}` });
  } finally {
    clearTimeout(timer);
  }
}
