import { NextRequest } from 'next/server';
import { z } from 'zod';
import { dispatchStream } from '@/lib/providers';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat — BYOK streaming proxy.
 * The user's API key travels per-request and is never logged or persisted.
 * Emits uniform SSE `data: <StreamEvent JSON>` followed by `data: [DONE]`.
 */

const partSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(200_000) }),
  z.object({ type: z.literal('image'), mimeType: z.string().max(100), data: z.string().max(8_000_000), name: z.string().optional() }),
  z.object({ type: z.literal('tool_call'), id: z.string().max(200), name: z.string().max(120), args: z.string().max(200_000) }),
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string().max(200),
    name: z.string().max(120),
    content: z.string().max(400_000),
    isError: z.boolean().optional(),
    requiresApproval: z.boolean().optional(),
  }),
]);

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  parts: z.array(partSchema).max(64),
});

const bodySchema = z.object({
  provider: z.string().max(40),
  baseUrl: z.string().max(500).optional().default(''),
  apiKey: z.string().max(2000).optional().default(''),
  model: z.string().max(200),
  messages: z.array(messageSchema).min(1).max(300),
  tools: z
    .array(
      z.object({
        name: z.string().max(120).regex(/^[a-zA-Z0-9_-]+$/, 'نام ابزار نامعتبر است'),
        description: z.string().max(2000),
        parameters: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(64)
    .optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(16).max(200_000).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`chat:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: `تعداد درخواست‌ها زیاد است. ${Math.ceil(rl.retryAfterMs / 1000)} ثانیه دیگر تلاش کنید.` },
      { status: 429 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    const check = bodySchema.safeParse(raw);
    if (!check.success) {
      return Response.json(
        { error: `بدنه درخواست نامعتبر است: ${check.error.issues[0]?.message ?? ''}` },
        { status: 400 },
      );
    }
    parsed = check.data;
  } catch {
    return Response.json({ error: 'JSON نامعتبر است.' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (evt: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };
      try {
        for await (const evt of dispatchStream({
          provider: parsed.provider as never,
          baseUrl: parsed.baseUrl,
          apiKey: parsed.apiKey,
          model: parsed.model,
          messages: parsed.messages as never,
          tools: parsed.tools as never,
          temperature: parsed.temperature,
          maxTokens: parsed.maxTokens,
          signal: abort.signal,
        })) {
          send(evt);
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          send({ type: 'error', message: `خطای غیرمنتظره سرور: ${String(e?.message ?? e).slice(0, 300)}` });
        }
      } finally {
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
