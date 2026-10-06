import { NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { runShell, isDangerousCommand } from '@/lib/server/workspace';
import { verifyCapability } from '@/lib/server/capability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tools/shell — sandboxed shell execution inside the workspace.
 *
 * Security model (human-in-the-loop):
 *  1. UI decides (per settings) whether the command needs explicit user approval
 *     and shows an approval dialog BEFORE calling this route.
 *  2. `approvedByHuman` must be true — the route refuses otherwise.
 *  3. Server-side backstop: destructive patterns are always rejected.
 *  4. Capability token: the request must carry the header issued with the page,
 *     so a third-party site or a bare curl cannot invoke this route.
 */
const bodySchema = z.object({
  command: z.string().min(1).max(4_000),
  timeoutMs: z.number().int().min(500).max(120_000).default(30_000),
  approvedByHuman: z.boolean(),
});

export async function POST(req: NextRequest) {
  const cap = await verifyCapability(req);
  if (cap !== true) return Response.json({ error: cap }, { status: 403 });

  const rl = rateLimit(`shell:${clientIp(req)}`, { limit: 15, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ اجرای فرمان' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'فرمان نامعتبر است.' }, { status: 400 });
  const { command, timeoutMs, approvedByHuman } = parsed.data;

  if (!approvedByHuman) {
    return Response.json(
      { error: 'اجرای فرمان شل بدون تأیید صریح انسانی مجاز نیست (سیاست امنیتی).' },
      { status: 403 },
    );
  }

  const danger = isDangerousCommand(command);
  if (danger.dangerous) {
    return Response.json(
      { error: `این فرمان در فهرست فرمان‌های ممنوع است و اجرا نمی‌شود: ${danger.reason}` },
      { status: 403 },
    );
  }

  const result = await runShell(command, { timeoutMs });
  return Response.json(result);
}
