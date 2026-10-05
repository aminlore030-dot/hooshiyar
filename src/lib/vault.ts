'use client';

/**
 * Encrypted key vault — BYOK security core.
 *
 * Design:
 *  - The user picks a vault passphrase (optionally blank = store obfuscated only).
 *  - Keys are AES-GCM encrypted with a key derived via PBKDF2-SHA256
 *    (250k iterations, random 16-byte salt, random 12-byte IV per save).
 *  - Only ciphertext + salt live in localStorage; the raw key material never
 *    leaves the browser and is never persisted server-side.
 *  - In-memory session cache keeps decrypted keys for the tab's lifetime.
 */

import type { KeyEntry } from '@/lib/types';

const STORAGE_KEY = 'hooshiyar.vault.v1';
const SESSION_KEY = 'hooshiyar.session.unlocked';

export interface VaultBlob {
  v: 1;
  /** PBKDF2 salt, base64. Empty when storing in plain (no passphrase). */
  salt: string;
  iv: string;
  /** AES-GCM ciphertext, base64 (JSON array of KeyEntry). */
  ct: string;
  /** Iteration count for forward compatibility. */
  iters: number;
  /** true when saved WITHOUT a passphrase (obfuscated base64 only). */
  plain?: boolean;
}

/* ------------------------------ crypto helpers ------------------------------ */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: iters, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ------------------------------- session state ------------------------------ */

let memoryKeys: KeyEntry[] | null = null;
let memoryPassphrase: string | null = null;

export function isUnlocked(): boolean {
  return memoryKeys !== null || sessionStorage.getItem(SESSION_KEY) === '1';
}

export function unlockPassphrase(): string | null {
  return memoryPassphrase;
}

/* --------------------------------- vault I/O -------------------------------- */

function readBlob(): VaultBlob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VaultBlob) : null;
  } catch {
    return null;
  }
}

function writeBlob(blob: VaultBlob) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

export async function saveKeys(
  keys: KeyEntry[],
  passphrase: string | null,
  iters = 250_000,
): Promise<void> {
  memoryKeys = [...keys];
  if (!passphrase) {
    // No passphrase: base64-obfuscated only (documented limitation).
    writeBlob({
      v: 1,
      salt: '',
      iv: '',
      ct: b64encode(enc.encode(JSON.stringify(keys))),
      iters: 0,
      plain: true,
    });
    sessionStorage.setItem(SESSION_KEY, '1');
    return;
  }
  memoryPassphrase = passphrase;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iters);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(JSON.stringify(keys)),
  );
  writeBlob({ v: 1, salt: b64encode(salt), iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)), iters });
  sessionStorage.setItem(SESSION_KEY, '1');
}

/** Decrypt the vault with a passphrase. Throws on wrong passphrase/corruption. */
export async function loadKeys(passphrase: string): Promise<KeyEntry[]> {
  const blob = readBlob();
  if (!blob) {
    memoryKeys = [];
    return [];
  }
  if (blob.plain) {
    try {
      memoryKeys = JSON.parse(dec.decode(b64decode(blob.ct))) as KeyEntry[];
      memoryPassphrase = null;
      return memoryKeys;
    } catch {
      throw new Error('گنجینه خراب است و قابل بازیابی نیست.');
    }
  }
  const key = await deriveKey(passphrase, b64decode(blob.salt), blob.iters || 250_000);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(blob.iv) as unknown as BufferSource },
      key,
      b64decode(blob.ct) as unknown as BufferSource,
    );
    memoryKeys = JSON.parse(dec.decode(pt)) as KeyEntry[];
    memoryPassphrase = passphrase;
    sessionStorage.setItem(SESSION_KEY, '1');
    return memoryKeys;
  } catch {
    throw new Error('رمز گنجینه اشتباه است یا داده‌ها آسیب دیده‌اند.');
  }
}

/** In-memory accessor (after unlock). */
export function getKeys(): KeyEntry[] {
  if (memoryKeys) return memoryKeys;
  const blob = readBlob();
  if (blob?.plain) {
    try {
      memoryKeys = JSON.parse(dec.decode(b64decode(blob.ct))) as KeyEntry[];
      return memoryKeys;
    } catch {
      return [];
    }
  }
  return [];
}

export function hasVault(): boolean {
  return readBlob() !== null;
}

export function isPlainVault(): boolean {
  return readBlob()?.plain === true;
}

export async function updateKeys(mutator: (keys: KeyEntry[]) => KeyEntry[]): Promise<KeyEntry[]> {
  const next = mutator(getKeys());
  await saveKeys(next, memoryPassphrase);
  return next;
}

/** Wipe the vault entirely (security settings). */
export function wipeVault(): void {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  memoryKeys = null;
  memoryPassphrase = null;
}

/**
 * Mask a key for display: show first 6 and last 4 chars only.
 */
export function maskKey(key: string): string {
  if (!key) return '—';
  if (key.length <= 10) return key.slice(0, 2) + '••••••';
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}
