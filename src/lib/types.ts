/**
 * Hooshiyar — Shared core types.
 * Provider-agnostic message / tool / streaming contracts used by both
 * the browser agent runtime and the server proxy routes.
 */

/* ---------------------------------- Messages --------------------------------- */

export interface TextPart {
  type: 'text';
  text: string;
}

/** Base64-encoded image (no data: prefix, keep mimeType separately). */
export interface ImagePart {
  type: 'image';
  mimeType: string;
  data: string;
  name?: string;
}

/** Request from the assistant to invoke a tool. args is a JSON string. */
export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  args: string;
}

/** Result fed back to the model after tool execution. */
export interface ToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  /** Set when a tool needs human approval before it can run. */
  requiresApproval?: boolean;
}

export type Part = TextPart | ImagePart | ToolCallPart | ToolResultPart;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface CoreMessage {
  role: ChatRole;
  parts: Part[];
}

export function textMsg(role: ChatRole, text: string): CoreMessage {
  return { role, parts: [{ type: 'text', text }] };
}

export function partsText(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/* ----------------------------------- Tools ----------------------------------- */

/** JSON-Schema (draft 2020-12 subset) for tool parameters. */
export type JsonSchemaObject = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

/* --------------------------------- Streaming --------------------------------- */

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'finish'; reason: string }
  | { type: 'error'; message: string };

/* --------------------------------- Providers --------------------------------- */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'fireworks'
  | 'ollama'
  | 'lmstudio'
  | 'custom'
  | 'hooshiyar-demo';

export interface ProviderInfo {
  id: ProviderId;
  /** Persian display name. */
  name: string;
  kind: 'openai' | 'anthropic' | 'gemini' | 'demo';
  defaultBaseUrl: string;
  docsUrl: string;
  /** Placeholder for the key field in Persian. */
  keyHint: string;
  /** Whether a base URL override makes sense. */
  supportsBaseUrl: boolean;
  /** Local/Ollama style providers don't strictly need a key. */
  keyOptional?: boolean;
}

export interface KeyEntry {
  id: string;
  provider: ProviderId;
  /** User label in Persian, e.g. «کلید اصلی اوپن‌ای‌آی». */
  label: string;
  baseUrl: string;
  model: string;
  /** Plain-text key (only lives in memory / encrypted at rest in the vault). */
  apiKey: string;
  createdAt: number;
  lastUsedAt?: number;
  lastTestOk?: boolean;
  lastTestAt?: number;
}

/** Request envelope sent (per-request, never persisted server-side) to /api/chat. */
export interface ProxyChatRequest {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: CoreMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/* ---------------------------------- Storage ---------------------------------- */

export interface FolderRec {
  id: string;
  name: string;
  createdAt: number;
}

export interface ChatRec {
  id: string;
  title: string;
  folderId: string | null;
  tags: string[];
  profileId: string;
  keyId: string | null;
  model: string;
  teamMode: boolean;
  pinned: boolean;
  /** Message id of the current branch leaf (for branching). */
  activeLeafId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  parentId: string | null;
  role: ChatRole;
  parts: Part[];
  /** Model that produced an assistant message. */
  model?: string;
  /** Wall clock of stream completion. */
  createdAt: number;
  /** ms to first token (assistant only, diagnostics). */
  ttftMs?: number;
  durationMs?: number;
}

export interface DocRec {
  id: string;
  name: string;
  size: number;
  mime: string;
  chunks: number;
  addedAt: number;
}

export interface ChunkRec {
  id: string;
  docId: string;
  idx: number;
  text: string;
}

export interface MemoryRec {
  id: string;
  text: string;
  source: 'manual' | 'agent';
  createdAt: number;
}

export interface AuditRec {
  id: string;
  ts: number;
  action: string;
  detail: string;
  status: 'ok' | 'error' | 'pending-approval' | 'approved' | 'denied';
}

export interface McpServerRec {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Cached tool list: [serverToolName, description]. */
  tools: { name: string; description: string }[];
  lastCheckedAt?: number;
  lastOk?: boolean;
}

/* --------------------------------- Settings ---------------------------------- */

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  temperature: number;
  maxTokens: number;
  /** Agent loop safety cap. */
  maxSteps: number;
  /** Require approval for every shell command (not just dangerous ones). */
  approveAllShell: boolean;
  /** Require approval for every shell command (not just dangerous ones). */
  enableTools: Record<string, boolean>;
  ttsEnabled: boolean;
  voiceLocale: string;
  /** Load-balancing: rotate among keys of the same provider. */
  keyRotation: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  temperature: 0.7,
  maxTokens: 2048,
  maxSteps: 12,
  approveAllShell: false,
  enableTools: {},
  ttsEnabled: false,
  voiceLocale: 'fa-IR',
  keyRotation: true,
};

/* ---------------------------------- Helpers ---------------------------------- */

export function genId(prefix = ''): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return prefix + c.randomUUID();
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Strip data: prefix from a dataURL, return {mimeType, data}. */
export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}
