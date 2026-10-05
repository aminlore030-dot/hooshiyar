'use client';

/**
 * Local-first RAG: text chunking + BM25 ranking, entirely in the browser.
 * No embeddings required (documented assumption: keyword BM25 covers
 * small/medium personal document sets well and needs zero keys).
 * Documents are added client-side; PDFs are pre-extracted to text by /api/upload.
 */
import { getDb } from '@/lib/idb';
import type { DocRec } from '@/lib/types';

/* -------------------------------- chunking --------------------------------- */

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let buf = '';
  const paragraphs = clean.split(/\n\n+/);
  for (const para of paragraphs) {
    if ((buf + '\n\n' + para).length > CHUNK_SIZE && buf) {
      chunks.push(buf.trim());
      // keep tail overlap
      buf = buf.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      buf = buf ? buf + '\n\n' + para : para;
    }
    // Hard-split oversized paragraphs (e.g. minified text).
    while (buf.length > CHUNK_SIZE * 2) {
      chunks.push(buf.slice(0, CHUNK_SIZE).trim());
      buf = buf.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 20);
}

export async function addDocument(name: string, text: string, mime = 'text/plain', size?: number): Promise<DocRec> {
  const db = await getDb();
  const pieces = chunkText(text);
  if (!pieces.length) throw new Error('متن سند خالی است یا قابل استخراج نبود.');
  const doc: DocRec = {
    id: crypto.randomUUID(),
    name,
    size: size ?? text.length,
    mime,
    chunks: pieces.length,
    addedAt: Date.now(),
  };
  await db.transaction('rw', db.documents, db.chunks, async () => {
    await db.documents.put(doc);
    await db.chunks.bulkPut(
      pieces.map((t, idx) => ({ id: `${doc.id}:${idx}`, docId: doc.id, idx, text: t })),
    );
  });
  return doc;
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = await getDb();
  await db.transaction('rw', db.documents, db.chunks, async () => {
    await db.documents.delete(docId);
    await db.chunks.where('docId').equals(docId).delete();
  });
}

/* ----------------------------------- BM25 ----------------------------------- */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'be', 'been',
  'that', 'this', 'with', 'for', 'on', 'as', 'at', 'by', 'it', 'from', 'but', 'not', 'we',
  'you', 'i', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'its', 'our', 'your',
  'که', 'را', 'و', 'در', 'به', 'از', 'این', 'آن', 'با', 'برای', 'است', 'هست', 'بود', 'شده',
  'می', 'های', 'هم', 'یک', 'تا', 'بر', 'نیز', 'یا', 'اما', 'اگر', 'پس', 'چون', 'هر',
]);

function normalize(s: string): string {
  // Persian normalization: Arabic yeh/kaf → Farsi, strip ZWNJ & diacritics.
  return s
    .replace(/[\u064A]/g, '\u06CC')
    .replace(/[\u0643]/g, '\u06A9')
    .replace(/[\u200B-\u200F\uFEFF]/g, ' ')
    .replace(/[\u064B-\u0652]/g, '')
    .toLowerCase();
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface RagHit {
  docId: string;
  chunkId: string;
  score: number;
  text: string;
  docName?: string;
}

/**
 * BM25 search across all indexed chunks. k1/b are standard defaults.
 */
export async function searchDocs(query: string, topK = 6): Promise<RagHit[]> {
  const db = await getDb();
  const [chunks, docs] = await Promise.all([db.chunks.toArray(), db.documents.toArray()]);
  if (!chunks.length) return [];

  const docName = new Map(docs.map((d) => [d.id, d.name]));
  const qTerms = tokenize(query).slice(0, 24);
  if (!qTerms.length) return [];

  // Build a lightweight inverted index over the corpus.
  const N = chunks.length;
  const df = new Map<string, number>();
  const docTokens: Map<string, number>[] = [];
  const lengths: number[] = [];
  const texts = new Map(chunks.map((c) => [c.id, c.text]));

  for (const ch of chunks) {
    const tf = new Map<string, number>();
    for (const t of tokenize(ch.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    docTokens.push(tf);
    lengths.push(tf.size);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgLen = lengths.reduce((a, b) => a + b, 0) / N || 1;

  const k1 = 1.4;
  const b = 0.72;
  const scores: RagHit[] = [];
  for (let i = 0; i < N; i++) {
    let score = 0;
    const tf = docTokens[i];
    for (const q of qTerms) {
      const f = tf.get(q);
      if (!f) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (lengths[i] / avgLen))));
    }
    if (score > 0.001) {
      const ch = chunks[i];
      scores.push({ docId: ch.docId, chunkId: ch.id, score, text: texts.get(ch.id) ?? '', docName: docName.get(ch.docId) });
    }
  }
  return scores.sort((a, c) => c.score - a.score).slice(0, topK);
}

/** Format hits as a compact context block for the model. */
export function formatHits(hits: RagHit[]): string {
  if (!hits.length) return 'هیچ بخش مرتبطی در اسناد پیدا نشد.';
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] سند: ${h.docName ?? h.docId}\n${h.text.slice(0, 1200)}`,
    )
    .join('\n---\n');
}
