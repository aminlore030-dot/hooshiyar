import { NextRequest } from 'next/server';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { WORKSPACE_ROOT, ensureWorkspace } from '@/lib/server/workspace';
import { verifyCapability } from '@/lib/server/capability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tools/py — sandboxed Python execution (agent tool).
 * Runs python3 as a child process with: workspace cwd, scrubbed env,
 * no network guard documented, wall-clock timeout, output caps.
 * Isolation note: same-user process sandbox; use the Docker deployment for
 * container-level isolation (see README).
 */
const bodySchema = z.object({
  code: z.string().min(1).max(40_000),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
});

/** Modules/imports that are outright denied (defense-in-depth backstop). */
const BLOCKED_IMPORTS = ['socket', 'subprocess', 'ctypes', 'multiprocessing', 'http.client'];

export async function POST(req: NextRequest) {
  const cap = await verifyCapability(req);
  if (cap !== true) return Response.json({ error: cap }, { status: 403 });

  const rl = rateLimit(`py:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ اجرای کد' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'کد نامعتبر است.' }, { status: 400 });
  const { code, timeoutMs } = parsed.data;

  for (const mod of BLOCKED_IMPORTS) {
    if (new RegExp(`^\\s*(import\\s+${mod}\\b|from\\s+${mod}\\b)`, 'm').test(code)) {
      return Response.json(
        { ok: false, error: `ایمپورت ماژول «${mod}» در سندباکس مجاز نیست.` },
        { status: 403 },
      );
    }
  }

  await ensureWorkspace();

  const started = Date.now();
  return new Promise<Response>((resolve) => {
    const child = spawn('python3', ['-I', '-u', '-c', code], {
      cwd: WORKSPACE_ROOT,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        HOME: WORKSPACE_ROOT,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        LANG: 'C.UTF-8',
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      if (stdout.length < 16_000) stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 8_000) stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(
        Response.json(
          { ok: false, error: `اجرای پایتون ممکن نشد: ${err.message}. آیا python3 نصب است؟` },
          { status: 500 },
        ),
      );
    });
    child.on('close', (code_) => {
      clearTimeout(timer);
      resolve(
        Response.json({
          ok: code_ === 0 && !timedOut,
          exitCode: code_,
          timedOut,
          stdout: stdout.slice(0, 16_000),
          stderr: stderr.slice(0, 8_000),
          durationMs: Date.now() - started,
        }),
      );
    });
  });
}
