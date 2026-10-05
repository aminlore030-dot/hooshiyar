import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listOpenAiModels, listAnthropicModels, listGeminiModels } from '@/lib/providers';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/providers/models — fetch the model list for a configured key. */
const bodySchema = z.object({
  provider: z.string().min(1),
  baseUrl: z.string().max(500).default(''),
  apiKey: z.string().max(2000).default(''),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(`models:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ درخواست' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });

  const { provider, baseUrl, apiKey } = parsed.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    let models: string[];
    switch (provider) {
      case 'anthropic':
        models = await listAnthropicModels(baseUrl || 'https://api.anthropic.com', apiKey, controller.signal);
        break;
      case 'gemini':
        models = await listGeminiModels(baseUrl || 'https://generativelanguage.googleapis.com/v1beta', apiKey, controller.signal);
        break;
      case 'hooshiyar-demo':
        models = ['glm-4-flash (دمو)'];
        break;
      default:
        if (!baseUrl) return Response.json({ error: 'آدرس پایه را وارد کنید.' }, { status: 400 });
        models = await listOpenAiModels(baseUrl, apiKey, controller.signal);
    }
    return Response.json({ models });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e).slice(0, 400) }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
