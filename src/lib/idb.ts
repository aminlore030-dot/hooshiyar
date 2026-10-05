'use client';

/**
 * Local-first persistence (IndexedDB via Dexie).
 *
 * Schema v1:
 *  - folders    : پوشه‌های گفتگو
 *  - chats      : گفتگوها (with active branch leaf)
 *  - messages   : پیام‌ها (message tree for branching: parentId)
 *  - documents  : اسناد RAG
 *  - chunks     : قطعات متن اسناد (برای بازیابی BM25)
 *  - memories   : حافظه بلندمدت
 *  - audit      : گزارش حسابرسی اقدامات عامل
 *  - mcpServers : سرورهای MCP کاربر
 *  - kv         : تنظیمات عمومی (settings)
 */
import Dexie, { type Table } from 'dexie';
import type {
  AuditRec,
  ChatRec,
  ChunkRec,
  DocRec,
  FolderRec,
  McpServerRec,
  MemoryRec,
  StoredMessage,
} from '@/lib/types';

export class HooshiyarDB extends Dexie {
  folders!: Table<FolderRec, string>;
  chats!: Table<ChatRec, string>;
  messages!: Table<StoredMessage, string>;
  documents!: Table<DocRec, string>;
  chunks!: Table<ChunkRec, string>;
  memories!: Table<MemoryRec, string>;
  audit!: Table<AuditRec, string>;
  mcpServers!: Table<McpServerRec, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('hooshiyar');
    this.version(1).stores({
      folders: 'id, createdAt',
      chats: 'id, folderId, updatedAt, pinned',
      messages: 'id, chatId, parentId, createdAt, [chatId+createdAt]',
      documents: 'id, addedAt',
      chunks: 'id, docId, [docId+idx]',
      memories: 'id, createdAt',
      audit: 'id, ts',
      mcpServers: 'id, enabled',
      kv: 'key',
    });
  }
}

let dbPromise: Promise<HooshiyarDB> | null = null;

/** Lazily open the DB (browser only). */
export function getDb(): Promise<HooshiyarDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new HooshiyarDB();
      await db.open();
      return db;
    })();
  }
  return dbPromise;
}

/* --------------------------------- settings --------------------------------- */

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.kv.put({ key, value });
}

/* ---------------------------------- audit ----------------------------------- */

export async function logAudit(
  action: string,
  detail: string,
  status: AuditRec['status'] = 'ok',
): Promise<void> {
  try {
    const db = await getDb();
    await db.audit.add({
      id: crypto.randomUUID(),
      ts: Date.now(),
      action,
      detail: detail.slice(0, 2000),
      status,
    });
    // Cap the log at 500 newest entries.
    const count = await db.audit.count();
    if (count > 500) {
      const old = await db.audit.orderBy('ts').limit(count - 500).primaryKeys();
      await db.audit.bulkDelete(old);
    }
  } catch {
    /* audit is best-effort */
  }
}

/* ------------------------------ message tree -------------------------------- */

/**
 * Walk from a leaf up to the root and return the active message path
 * (root → leaf order). Handles branching/editing/regeneration.
 */
export async function activePath(chatId: string, leafId: string | null): Promise<StoredMessage[]> {
  const db = await getDb();
  const all = await db.messages.where('chatId').equals(chatId).toArray();
  const byId = new Map(all.map((m) => [m.id, m]));

  let leaf: StoredMessage | undefined;
  if (leafId && byId.has(leafId)) leaf = byId.get(leafId);
  else {
    // Fall back to the newest message.
    leaf = all.sort((a, b) => a.createdAt - b.createdAt).at(-1);
  }
  if (!leaf) return [];

  const path: StoredMessage[] = [];
  let cur: StoredMessage | undefined = leaf;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** Siblings of a message (same parent) — used for branch switcher UI. */
export async function siblingsOf(msg: StoredMessage): Promise<StoredMessage[]> {
  const db = await getDb();
  const all = await db.messages.where('chatId').equals(msg.chatId).toArray();
  return all
    .filter((m) => (m.parentId ?? null) === (msg.parentId ?? null) && m.role === msg.role)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/* --------------------------------- data mgmt -------------------------------- */

export async function exportAllData(): Promise<string> {
  const db = await getDb();
  const [folders, chats, messages, documents, chunks, memories] = await Promise.all([
    db.folders.toArray(),
    db.chats.toArray(),
    db.messages.toArray(),
    db.documents.toArray(),
    db.chunks.toArray(),
    db.memories.toArray(),
  ]);
  return JSON.stringify(
    { format: 'hooshiyar.export', v: 1, exportedAt: new Date().toISOString(), folders, chats, messages, documents, chunks, memories },
    null,
    2,
  );
}

export interface ImportSummary {
  chats: number;
  messages: number;
  folders: number;
  documents: number;
  memories: number;
}

export async function importAllData(json: string): Promise<ImportSummary> {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (data.format !== 'hooshiyar.export') throw new Error('قالب فایل پشتیبانی نمی‌شود.');
  const db = await getDb();
  const put = async <T extends Table>(table: T, rows: unknown): Promise<number> => {
    if (!Array.isArray(rows) || !rows.length) return 0;
    await table.bulkPut(rows as never[]);
    return rows.length;
  };
  const s: ImportSummary = {
    folders: await put(db.folders, data.folders),
    chats: await put(db.chats, data.chats),
    messages: await put(db.messages, data.messages),
    documents: await put(db.documents, data.documents),
    memories: await put(db.memories, data.memories),
  };
  await put(db.chunks, data.chunks);
  return s;
}

/** Delete every conversation, message, document and memory (keeps vault). */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.folders.clear(),
    db.chats.clear(),
    db.messages.clear(),
    db.documents.clear(),
    db.chunks.clear(),
    db.memories.clear(),
    db.audit.clear(),
  ]);
}

export async function wipeChat(chatId: string): Promise<void> {
  const db = await getDb();
  await db.transaction('rw', db.chats, db.messages, async () => {
    await db.messages.where('chatId').equals(chatId).delete();
    await db.chats.delete(chatId);
  });
}
