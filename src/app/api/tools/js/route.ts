import { NextRequest } from 'next/server';
import { z } from 'zod';
import vm from 'node:vm';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { WORKSPACE_ROOT, ensureWorkspace } from '@/lib/server/workspace';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tools/js — sandboxed JavaScript execution (agent tool).
 * Isolation model (documented limitation): node:vm with frozen globals,
 * no require/process/network, wall-clock timeout, 64MB heap guard.
 * For stronger isolation run the Docker deployment (separate container).
 */
const bodySchema = z.object({
  code: z.string().min(1).max(40_000),
  timeoutMs: z.number().int().min(100).max(20_000).default(5_000),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(`js:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ اجرای کد' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'کد نامعتبر است.' }, { status: 400 });
  const { code, timeoutMs } = parsed.data;

  const logs: string[] = [];
  const push = (level: string) => (...args: unknown[]) => {
    if (logs.length > 400) return;
    const line = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    logs.push(level === 'error' ? `⛔ ${line}` : line);
  };

  await ensureWorkspace();

  const sandbox: Record<string, unknown> = {
    console: { log: push('log'), info: push('log'), warn: push('warn'), error: push('error') },
    workspaceDir: WORKSPACE_ROOT,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 2000)),
    clearTimeout,
    Buffer: undefined,
    process: undefined,
    require: undefined,
    fetch: undefined,
    global: undefined,
    globalThis: undefined,
  };

  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

  const started = Date.now();
  const runScript = (src: string) =>
    vm.runInContext(src, context, {
      timeout: timeoutMs,
      displayErrors: true,
      filename: 'agent-sandbox.js',
      breakOnSigint: true,
    });

  try {
    // Support top-level `return` (REPL-style) by falling back to an IIFE wrap,
    // and await Promises so top-level await works.
    let result: unknown;
    try {
      result = runScript(code);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/illegal return|return statement/i.test(msg)) {
        result = runScript(`(function(){\n${code}\n})()`);
      } else {
        throw e;
      }
    }
    if (result && typeof (result as any).then === 'function') {
      const awaited = await Promise.race([
        result as Promise<unknown>,
        new Promise((_r, rej) => setTimeout(() => rej(new Error('زمان اجرا به پایان رسید.')), timeoutMs)),
      ]);
      result = awaited;
    }
    let resultText = 'undefined';
    if (result !== undefined) {
      try {
        resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      } catch {
        resultText = String(result);
      }
    }
    return Response.json({
      ok: true,
      logs,
      result: resultText.slice(0, 12_000),
      durationMs: Date.now() - started,
    });
  } catch (e: any) {
    return Response.json({
      ok: false,
      logs,
      result: null,
      error: String(e?.message ?? e).slice(0, 4_000),
      durationMs: Date.now() - started,
    });
  }
}
