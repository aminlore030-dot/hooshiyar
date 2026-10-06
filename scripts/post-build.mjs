/**
 * post-build — copy static assets + public/ into the standalone output dir.
 * Replaces `cp -r` so the build works identically on Linux, macOS and Windows
 * (CI + Vercel + self-host).
 *
 * `next build` with `output: 'standalone'` writes a nested dir named after the
 * project root inside .next/standalone — we resolve it rather than assume.
 */
import { cp, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const nextDir = join(root, '.next');

const standaloneRoot = join(nextDir, 'standalone');
if (!existsSync(standaloneRoot)) {
  console.warn('[post-build] no standalone dir — nothing to do');
  process.exit(0);
}

// The standalone server runs from the nested project dir.
const projectDir = existsSync(join(standaloneRoot, 'package.json'))
  ? standaloneRoot
  : join(standaloneRoot, root.split(/[\\/]/).pop());

const copy = (from, to) =>
  new Promise((res, rej) => {
    if (!existsSync(from)) {
      console.warn(`[post-build] skip missing: ${from}`);
      return res();
    }
    cp(from, to, { recursive: true }, (err) => (err ? rej(err) : res()));
  });

try {
  mkdirSync(join(projectDir, '.next'), { recursive: true });
  await copy(join(nextDir, 'static'), join(projectDir, '.next', 'static'));
  await copy(join(root, 'public'), join(projectDir, 'public'));
  console.log(`[post-build] copied static + public into ${projectDir}`);
} catch (e) {
  console.error('[post-build] failed:', e?.message ?? e);
  process.exit(1);
}
