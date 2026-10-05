import 'server-only';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Workspace sandbox for the agent's file system tools.
 * All agent file I/O is confined to WORKSPACE_ROOT (default <project>/workspace).
 */

export const WORKSPACE_ROOT = process.env.HOOSHIYAR_WORKSPACE
  ? path.resolve(process.env.HOOSHIYAR_WORKSPACE)
  : path.join(process.cwd(), 'workspace');

/** Resolve a relative path and guarantee it stays inside the workspace root. */
export function resolveSafe(relPath: string): string {
  const p = path.resolve(WORKSPACE_ROOT, relPath.replace(/^[/\\]+/, ''));
  const root = path.resolve(WORKSPACE_ROOT);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new Error('مسیر خارج از محدوده پوشه کاری مجاز نیست.');
  }
  return p;
}

export async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
}

export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
}

/** Recursively list files (depth-limited). */
export async function listFiles(relPath = '', depth = 4): Promise<FileNode[]> {
  await ensureWorkspace();
  const abs = resolveSafe(relPath || '.');
  const out: FileNode[] = [];
  async function walk(dir: string, rel: string, d: number) {
    if (d < 0) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const absChild = path.join(dir, e.name);
      const relChild = rel ? `${rel}/${e.name}` : e.name;
      try {
        const st = await fs.stat(absChild);
        out.push({
          path: relChild,
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          size: st.size,
          mtime: st.mtimeMs,
        });
        if (e.isDirectory()) await walk(absChild, relChild, d - 1);
      } catch {
        /* skip unreadable */
      }
    }
  }
  await walk(abs, relPath.replace(/^\/+|\/+$/g, ''), depth);
  return out;
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sql', 'html', 'css', 'scss', 'xml',
]);

export function isTextFile(name: string): boolean {
  return TEXT_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '');
}

export async function readFile(relPath: string): Promise<string> {
  const abs = resolveSafe(relPath);
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`فایل «${relPath}» پیدا نشد.`);
  if (st.size > 512 * 1024) throw new Error('فایل بزرگ‌تر از ۵۱۲ کیلوبایت است.');
  return fs.readFile(abs, 'utf8');
}

export async function writeFile(relPath: string, content: string): Promise<{ bytes: number }> {
  await ensureWorkspace();
  const abs = resolveSafe(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return { bytes: Buffer.byteLength(content, 'utf8') };
}

export async function deletePath(relPath: string): Promise<void> {
  const abs = resolveSafe(relPath);
  await fs.rm(abs, { recursive: true, force: true });
}

/* ---------------------------- shell command guard ---------------------------- */

/**
 * Heuristic blocklist for obviously destructive commands. The full approval
 * flow lives in the UI (human-in-the-loop); this is the server-side backstop.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+[\s/~]/, // rm -rf /
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/,
  /:\(\)\s*\{.*\};\s*:/, // fork bomb
  /\bmkfs\b/,
  /\bdd\s+if=\/dev\/(zero|random)\s+of=\/dev\/[sh]d/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bchmod\s+-R?\s*777\s+\//,
  /\bmkfs\.\w+/,
  /\b>\s*\/dev\/[sh]da/,
  /\bcurl\s+[^\|]*\|\s*(sudo\s+)?(ba)?sh\b/, // curl | sh
  /\bwget\s+[^\|]*\|\s*(sudo\s+)?(ba)?sh\b/,
  /\bsudo\b/,
];

export function isDangerousCommand(cmd: string): { dangerous: boolean; reason?: string } {
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) return { dangerous: true, reason: 'فرمان با الگوهای خطرناک مطابقت دارد' };
  }
  return { dangerous: false };
}

export async function runShell(
  command: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  const { exec } = await import('node:child_process');
  await ensureWorkspace();
  const timeoutMs = Math.min(opts.timeoutMs ?? 30_000, 120_000);
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: WORKSPACE_ROOT,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          HOME: WORKSPACE_ROOT,
          LANG: 'C.UTF-8',
          TERM: 'dumb',
        } as NodeJS.ProcessEnv,
      },
      (err, stdout, stderr) => {
        const timedOut = err?.killed === true || err?.signal === 'SIGTERM';
        resolve({
          stdout: String(stdout ?? '').slice(0, 16_000),
          stderr: String(stderr ?? err?.message ?? '').slice(0, 8_000),
          code: err?.code ?? (typeof err?.code === 'number' ? err.code : 0),
          timedOut,
        });
      },
    );
  });
}
