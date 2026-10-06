'use client';

/**
 * Tool executor — runs agent tool calls from the browser.
 * Server-backed tools call the sandbox APIs; local tools (RAG, memory)
 * hit IndexedDB; MCP tools are relayed through /api/mcp-proxy.
 */
import { getDb, logAudit } from '@/lib/idb';
import { searchDocs, formatHits } from '@/lib/rag';
import { commandNeedsApproval } from '@/lib/agent/tools';
import { capabilityHeaders } from '@/lib/client/capability';

export interface ToolExecContext {
  approveAllShell: boolean;
  /** Called when a tool needs explicit human approval. Resolves with approve/deny. */
  requestApproval: (info: { toolName: string; summary: string; detail: string }) => Promise<boolean>;
  /** Enabled MCP servers (id → {name, url}). */
  mcpServers: { id: string; name: string; url: string }[];
}

export interface ToolExecResult {
  ok: boolean;
  content: string;
  /** true when the user explicitly denied an approval request. */
  denied?: boolean;
}

async function jsonFetch<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...capabilityHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  const json = await jsonSafe<T>(res);
  return json;
}

async function jsonSafe<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`پاسخ نامعتبر سرور (${res.status})`);
  }
}

function truncate(s: string, max = 12_000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [بریده شد؛ طول کل ${s.length} نویسه]`;
}

/* ------------------------------- MCP plumbing ------------------------------- */

let mcpNextId = 1;

async function mcpCall(
  server: { id: string; name: string; url: string },
  method: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch('/api/mcp-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...capabilityHeaders() },
    body: JSON.stringify({
      url: server.url,
      payload: { jsonrpc: '2.0', id: mcpNextId++, method, params: params ?? {} },
    }),
    signal,
  });
  const json = await jsonSafe<any>(res);
  if (json.error) throw new Error(`MCP «${server.name}»: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result ?? {};
}

/** Discover tools (with input schemas) from all enabled MCP servers. */
export async function discoverMcpTools(
  servers: { id: string; name: string; url: string }[],
): Promise<Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]>> {
  const out = new Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]>();
  await Promise.all(
    servers.map(async (s) => {
      try {
        const result = await mcpCall(s, 'tools/list');
        const tools = (result.tools as any[] ?? []).map((t) => ({
          name: String(t.name),
          description: String(t.description ?? ''),
          inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        }));
        out.set(s.id, tools);
      } catch {
        out.set(s.id, []);
      }
    }),
  );
  return out;
}

/* -------------------------------- executors -------------------------------- */

export async function executeTool(
  name: string,
  argsJson: string,
  ctx: ToolExecContext,
  signal?: AbortSignal,
): Promise<ToolExecResult> {
  let args: Record<string, any>;
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return { ok: false, content: `خطا: آرگومان‌های ابزار JSON معتبر نیست: ${argsJson.slice(0, 200)}` };
  }

  // MCP tools use the mcp__serverId__toolName convention.
  if (name.startsWith('mcp__')) {
    return execMcp(name, args, ctx, signal);
  }

  switch (name) {
    case 'web_search': {
      try {
        const json = await jsonFetch<any>(
          '/api/tools/search',
          { query: args.query, num: Math.min(args.num ?? 6, 10), recencyDays: args.recency_days },
          signal,
        );
        if (json.error) return { ok: false, content: `خطای جستجو: ${json.error}` };
        const lines = (json.results as any[]).map(
          (r, i) => `${i + 1}. ${r.title}\n   آدرس: ${r.url}\n   خلاصه: ${r.snippet}${r.date ? `\n   تاریخ: ${r.date}` : ''}`,
        );
        await logAudit('web_search', `پرس‌وجو: ${args.query}`, 'ok');
        return { ok: true, content: truncate(lines.join('\n\n') || 'نتیجه‌ای یافت نشد.') };
      } catch (e: any) {
        await logAudit('web_search', `پرس‌وجو: ${args.query}`, 'error');
        return { ok: false, content: `خطای جستجو: ${e?.message ?? e}` };
      }
    }

    case 'web_fetch': {
      try {
        const json = await jsonFetch<any>(
          '/api/tools/fetch',
          { url: args.url, maxChars: Math.min(args.max_chars ?? 12_000, 30_000) },
          signal,
        );
        if (json.error) return { ok: false, content: `خطای خواندن صفحه: ${json.error}` };
        await logAudit('web_fetch', args.url, 'ok');
        return { ok: true, content: truncate(json.text) };
      } catch (e: any) {
        await logAudit('web_fetch', args.url, 'error');
        return { ok: false, content: `خطای خواندن صفحه: ${e?.message ?? e}` };
      }
    }

    case 'run_js': {
      try {
        const json = await jsonFetch<any>('/api/tools/js', { code: args.code, timeoutMs: 5_000 }, signal);
        const out = [
          json.logs?.length ? `خروجی console:\n${json.logs.join('\n')}` : '',
          json.ok !== false ? `نتیجه: ${json.result ?? 'undefined'}` : '',
          json.error ? `خطا: ${json.error}` : '',
        ].filter(Boolean).join('\n');
        await logAudit('run_js', `کد: ${args.code.slice(0, 200)}`, json.ok ? 'ok' : 'error');
        return { ok: json.ok !== false, content: truncate(out || 'اجرای بی‌خروجی.') };
      } catch (e: any) {
        return { ok: false, content: `خطای اجرای JS: ${e?.message ?? e}` };
      }
    }

    case 'run_python': {
      try {
        const json = await jsonFetch<any>('/api/tools/py', { code: args.code, timeoutMs: 10_000 }, signal);
        const out = [
          json.stdout ? `stdout:\n${json.stdout}` : '',
          json.stderr ? `stderr:\n${json.stderr}` : '',
          json.timedOut ? '⛔ زمان اجرا به پایان رسید.' : '',
          json.error ? `خطا: ${json.error}` : '',
        ].filter(Boolean).join('\n');
        await logAudit('run_python', `کد: ${args.code.slice(0, 200)}`, json.ok ? 'ok' : 'error');
        return { ok: json.ok === true, content: truncate(out || 'اجرای بی‌خروجی.') };
      } catch (e: any) {
        return { ok: false, content: `خطای اجرای پایتون: ${e?.message ?? e}` };
      }
    }

    case 'run_shell': {
      const command = String(args.command ?? '');
      const needs = commandNeedsApproval(command, ctx.approveAllShell);
      let approved = true;
      if (needs) {
        await logAudit('run_shell', `در انتظار تأیید: ${command}`, 'pending-approval');
        approved = await ctx.requestApproval({
          toolName: 'run_shell',
          summary: command.slice(0, 300),
          detail: 'این فرمان شل در پوشه کاری سرور اجرا می‌شود.',
        });
        await logAudit('run_shell', `تأیید کاربر برای: ${command}`, approved ? 'approved' : 'denied');
        if (!approved) {
          return { ok: false, denied: true, content: 'کاربر اجرای این فرمان را رد کرد. بدون اجازه ادامه نده و کار دیگری پیشنهاد بده.' };
        }
      }
      try {
        const json = await jsonFetch<any>(
          '/api/tools/shell',
          { command, timeoutMs: Math.min(args.timeout_ms ?? 30_000, 120_000), approvedByHuman: true },
          signal,
        );
        if (json.error) return { ok: false, content: `خطای اجرای فرمان: ${json.error}` };
        const out = [
          json.stdout ? `stdout:\n${json.stdout}` : '',
          json.stderr ? `stderr:\n${json.stderr}` : '',
          json.timedOut ? '⛔ زمان اجرا تمام شد.' : '',
          json.code != null && json.code !== 0 ? `کد خروج: ${json.code}` : '',
        ].filter(Boolean).join('\n');
        return { ok: json.code === 0, content: truncate(out || 'اجرای بی‌خروجی (کد ۰).') };
      } catch (e: any) {
        return { ok: false, content: `خطای اجرای فرمان: ${e?.message ?? e}` };
      }
    }

    case 'read_file': {
      try {
        const json = await jsonFetch<any>('/api/files', { op: 'read', path: args.path }, signal);
        if (json.error) return { ok: false, content: `خطا: ${json.error}` };
        return { ok: true, content: truncate(json.content) };
      } catch (e: any) {
        return { ok: false, content: `خطای خواندن فایل: ${e?.message ?? e}` };
      }
    }

    case 'write_file': {
      try {
        const json = await jsonFetch<any>(
          '/api/files',
          { op: 'write', path: args.path, content: String(args.content ?? '') },
          signal,
        );
        if (json.error) return { ok: false, content: `خطا: ${json.error}` };
        await logAudit('write_file', args.path, 'ok');
        return { ok: true, content: `فایل «${args.path}» ذخیره شد (${json.bytes} بایت).` };
      } catch (e: any) {
        return { ok: false, content: `خطای نوشتن فایل: ${e?.message ?? e}` };
      }
    }

    case 'list_files': {
      try {
        const json = await jsonFetch<any>('/api/files', { op: 'list', path: args.path ?? '' }, signal);
        if (json.error) return { ok: false, content: `خطا: ${json.error}` };
        const files = json.files as any[];
        if (!files.length) return { ok: true, content: 'پوشه کاری خالی است.' };
        return {
          ok: true,
          content: files
            .map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}${f.type === 'file' ? ` (${f.size}B)` : ''}`)
            .join('\n'),
        };
      } catch (e: any) {
        return { ok: false, content: `خطای فهرست فایل‌ها: ${e?.message ?? e}` };
      }
    }

    case 'search_docs': {
      try {
        const hits = await searchDocs(String(args.query ?? ''), Math.min(args.top_k ?? 5, 10));
        await logAudit('search_docs', `پرس‌وجو: ${args.query}`, 'ok');
        return { ok: true, content: truncate(formatHits(hits), 10_000) };
      } catch (e: any) {
        return { ok: false, content: `خطای جستجوی اسناد: ${e?.message ?? e}` };
      }
    }

    case 'remember': {
      try {
        const db = await getDb();
        await db.memories.add({
          id: crypto.randomUUID(),
          text: String(args.fact ?? '').slice(0, 500),
          source: 'agent',
          createdAt: Date.now(),
        });
        await logAudit('remember', String(args.fact ?? ''), 'ok');
        return { ok: true, content: 'در حافظه بلندمدت ذخیره شد.' };
      } catch (e: any) {
        return { ok: false, content: `خطای ذخیره حافظه: ${e?.message ?? e}` };
      }
    }

    default:
      return { ok: false, content: `ابزار ناشناخته: ${name}` };
  }
}

async function execMcp(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
  signal?: AbortSignal,
): Promise<ToolExecResult> {
  // mcp__<serverId>__<toolName>
  const [, serverId, ...rest] = name.split('__');
  const toolName = rest.join('__');
  const server = ctx.mcpServers.find((s) => s.id === serverId);
  if (!server) return { ok: false, content: `سرور MCP با شناسه «${serverId}» یافت نشد.` };
  try {
    const result = await mcpCall(server, 'tools/call', { name: toolName, arguments: args }, signal);
    const items = (result.content as any[] ?? []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)));
    await logAudit('mcp_call', `${server.name}/${toolName}`, 'ok');
    return { ok: !result.isError, content: truncate(items.join('\n') || 'پاسخ خالی از سرور MCP.') };
  } catch (e: any) {
    await logAudit('mcp_call', `${server.name}/${toolName}`, 'error');
    return { ok: false, content: `خطای ابزار MCP: ${e?.message ?? e}` };
  }
}
