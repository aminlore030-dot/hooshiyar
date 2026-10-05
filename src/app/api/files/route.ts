import { NextRequest } from 'next/server';
import { z } from 'zod';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { ensureWorkspace, listFiles, readFile, writeFile, deletePath } from '@/lib/server/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Workspace file API for the agent's file tools and the file browser panel.
 * All paths are sandboxed to the workspace root (see lib/server/workspace).
 */

const readSchema = z.object({ op: z.literal('read'), path: z.string().max(500) });
const writeSchema = z.object({ op: z.literal('write'), path: z.string().max(500), content: z.string().max(1_000_000) });
const listSchema = z.object({ op: z.literal('list'), path: z.string().max(500).optional().default('') });
const deleteSchema = z.object({ op: z.literal('delete'), path: z.string().max(500) });
const bodySchema = z.discriminatedUnion('op', [listSchema, readSchema, writeSchema, deleteSchema]);

export async function POST(req: NextRequest) {
  const rl = rateLimit(`files:${clientIp(req)}`, { limit: 90, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: 'محدودیت نرخ درخواست' }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
  const body = parsed.data;

  try {
    switch (body.op) {
      case 'list': {
        await ensureWorkspace();
        const files = await listFiles(body.path || '');
        return Response.json({ files });
      }
      case 'read': {
        const content = await readFile(body.path);
        return Response.json({ content });
      }
      case 'write': {
        const res = await writeFile(body.path, body.content);
        return Response.json({ ok: true, bytes: res.bytes });
      }
      case 'delete': {
        await deletePath(body.path);
        return Response.json({ ok: true });
      }
    }
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 400 });
  }
}
