/**
 * هوش‌یار MCP Server — an independent Model Context Protocol server
 * (Streamable HTTP transport, JSON-RPC 2.0).
 *
 * Exposes the workspace tools so EXTERNAL MCP clients (Claude Desktop, IDEs…)
 * can use them, and so Hooshiyar itself can connect via its MCP client.
 *
 * Port: 3010 (fixed). Start: bun run dev (uses bun --hot for auto-restart).
 *
 * Methods implemented (tools subset of MCP):
 *   initialize, ping, tools/list, tools/call
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = 3010;

/* ------------------------------- tool backend ------------------------------- */

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const TOOLS = [
  {
    name: 'workspace_write',
    description: 'نوشتن یک فایل متنی در پوشه کاری هوش‌یار (sandboxed workspace)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل' },
        content: { type: 'string', description: 'محتوای فایل' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'workspace_read',
    description: 'خواندن محتوای یک فایل از پوشه کاری هوش‌یار',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'workspace_list',
    description: 'فهرست فایل‌های پوشه کاری هوش‌یار',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'مسیر شروع' } } },
  },
  {
    name: 'run_python',
    description: 'اجرای پایتون در سندباکس هوش‌یار (بدون شبکه، محدود زمانی)',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
  },
  {
    name: 'now',
    description: 'تاریخ و زمان فعلی به فارسی',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    switch (name) {
      case 'now': {
        const text = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeStyle: 'short' }).format(new Date());
        return { content: [{ type: 'text', text }] };
      }
      case 'workspace_list': {
        const rel = String(args.path ?? '');
        const res = await fetch(`http://127.0.0.1:3000/api/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'list', path: rel }),
        });
        const json = (await res.json()) as { files?: { path: string; type: string }[] };
        const text = (json.files ?? []).map((f) => `${f.type === 'dir' ? 'dir ' : 'file'} ${f.path}`).join('\n') || '(خالی)';
        return { content: [{ type: 'text', text }] };
      }
      case 'workspace_read': {
        const res = await fetch(`http://127.0.0.1:3000/api/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'read', path: args.path }),
        });
        const json = (await res.json()) as { content?: string; error?: string };
        if (json.error) return { content: [{ type: 'text', text: json.error }], isError: true };
        return { content: [{ type: 'text', text: json.content ?? '' }] };
      }
      case 'workspace_write': {
        const res = await fetch(`http://127.0.0.1:3000/api/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'write', path: args.path, content: args.content }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string; bytes?: number };
        if (json.error) return { content: [{ type: 'text', text: json.error }], isError: true };
        return { content: [{ type: 'text', text: `ذخیره شد (${json.bytes} بایت)` }] };
      }
      case 'run_python': {
        const res = await fetch(`http://127.0.0.1:3000/api/tools/py`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: args.code, timeoutMs: 10_000 }),
        });
        const json = (await res.json()) as { stdout?: string; stderr?: string; error?: string };
        if (json.error) return { content: [{ type: 'text', text: json.error }], isError: true };
        return { content: [{ type: 'text', text: [json.stdout, json.stderr].filter(Boolean).join('\n') || '(بی‌خروجی)' }] };
      }
      default:
        return { content: [{ type: 'text', text: `ابزار ناشناخته: ${name}` }], isError: true };
    }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `خطا: ${e?.message ?? e}` }], isError: true };
  }
}

/* ------------------------------ HTTP + JSON-RPC ----------------------------- */

async function handleRpc(body: any): Promise<unknown> {
  const { id, method, params } = body ?? {};
  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hooshiyar-workspace', version: '1.0.0' },
      });
    case 'ping':
      return jsonRpcResult(id, {});
    case 'tools/list':
      return jsonRpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      return jsonRpcResult(id, await callTool(name, args));
    }
    default:
      return jsonRpcError(id, -32601, `متد یافت نشد: ${method}`);
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS for browser MCP clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ server: 'hooshiyar-workspace', transport: 'streamable-http', tools: TOOLS.length }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 2_000_000) req.destroy();
  });
  req.on('end', async () => {
    let body: any;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(jsonRpcError(null, -32700, 'JSON نامعتبر')));
      return;
    }
    // single request (batch not needed for this server)
    const out = await handleRpc(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  });
});

server.listen(PORT, () => {
  console.log(`[mcp-server] Hooshiyar MCP server listening on http://localhost:${PORT}/mcp`);
});
