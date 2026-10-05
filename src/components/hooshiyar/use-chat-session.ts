'use client';

/**
 * useChatSession — chat operations wiring Dexie persistence + the agent loop.
 * Handles: send (text/attachments), regenerate, edit-as-branch, stop,
 * system-prompt assembly (profile + long-term memory), turn persistence.
 */
import { useCallback } from 'react';
import type { CoreMessage, KeyEntry, Part, StoredMessage, ToolResultPart } from '@/lib/types';
import { genId, textMsg } from '@/lib/types';
import { getDb, logAudit, activePath } from '@/lib/idb';
import { useAppStore, type ToolChip } from '@/components/hooshiyar/store';
import { runAgentLoop } from '@/lib/agent/loop';
import { getProfile } from '@/lib/agent/profiles';
import { TOOL_PERSIAN_NAMES } from '@/lib/agent/tools';
import { searchDocs, formatHits } from '@/lib/rag';

const bump = () => useAppStore.getState().bumpDb();

/* ------------------------------ helpers ------------------------------ */

export async function createChat(opts: {
  title?: string;
  profileId?: string;
  keyId?: string | null;
  model?: string;
  teamMode?: boolean;
  folderId?: string | null;
}): Promise<string> {
  const db = await getDb();
  const id = genId('chat_');
  const now = Date.now();
  await db.chats.add({
    id,
    title: opts.title ?? 'گفتگوی جدید',
    folderId: opts.folderId ?? null,
    tags: [],
    profileId: opts.profileId ?? 'hermes',
    keyId: opts.keyId ?? null,
    model: opts.model ?? '',
    teamMode: opts.teamMode ?? false,
    pinned: false,
    activeLeafId: null,
    createdAt: now,
    updatedAt: now,
  });
  bump();
  return id;
}

export async function touchChat(chatId: string, patch: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.chats.update(chatId, { ...patch, updatedAt: Date.now() });
}

async function addMessage(msg: Omit<StoredMessage, 'createdAt'> & { createdAt?: number }): Promise<StoredMessage> {
  const db = await getDb();
  const full: StoredMessage = { createdAt: Date.now(), ...msg } as StoredMessage;
  await db.messages.put(full);
  await db.chats.update(full.chatId, { updatedAt: Date.now(), activeLeafId: full.id });
  bump();
  return full;
}

/** Build the system prompt: profile persona + long-term memories + date. */
async function buildSystemPrompt(profileId: string, enableRagAuto: boolean, userText: string): Promise<string> {
  const db = await getDb();
  const profile = getProfile(profileId);
  const memories = await db.memories.orderBy('createdAt').reverse().limit(30).toArray();
  const today = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());

  let sys = profile.systemPrompt;
  sys += `\n\nامروز: ${today}.`;

  if (memories.length) {
    sys += `\n\nحافظه بلندمدت درباره کاربر:\n${memories.map((m) => `- ${m.text}`).join('\n')}`;
  }

  if (enableRagAuto && userText.trim().length > 3) {
    try {
      const hits = await searchDocs(userText, 3);
      if (hits.length) {
        sys += `\n\nقطعات مرتبط از اسناد کاربر (برای ارجاع استفاده کن):\n${formatHits(hits).slice(0, 6000)}`;
      }
    } catch {
      /* RAG auto-context is best-effort */
    }
  }
  return sys;
}

/** Convert persisted messages to provider CoreMessages. */
function toCoreMessages(path: StoredMessage[]): CoreMessage[] {
  return path.map((m) => ({ role: m.role, parts: m.parts }));
}

function summarizeArgs(name: string, args: string): string {
  try {
    const a = JSON.parse(args || '{}');
    if (name === 'web_search' || name === 'search_docs') return String(a.query ?? '');
    if (name === 'web_fetch') return String(a.url ?? '');
    if (name === 'run_shell') return String(a.command ?? '');
    if (name === 'read_file' || name === 'write_file' || name === 'list_files') return String(a.path ?? a.query ?? '');
    if (name === 'run_js' || name === 'run_python') return (String(a.code ?? '')).slice(0, 80);
    if (name === 'remember') return String(a.fact ?? '');
    return args.slice(0, 80);
  } catch {
    return args.slice(0, 80);
  }
}

/* ------------------------------ the hook ------------------------------ */

export function useChatSession() {
  const store = useAppStore;

  const resolveKey = useCallback((chat: { keyId: string | null }): KeyEntry | null => {
    const keys = store.getState().keys;
    if (chat.keyId) {
      const exact = keys.find((k) => k.id === chat.keyId);
      if (exact) return exact;
    }
    return keys[0] ?? null;
  }, [store]);

  /** Run the agent loop for the current conversation tail. */
  const runTurn = useCallback(
    async (chatId: string, parentMessageId: string | null) => {
      const s = store.getState();
      const db = await getDb();
      const chat = await db.chats.get(chatId);
      if (!chat) return;

      const key = resolveKey(chat);
      if (!key) {
        s.openDialog('settings-keys');
        return;
      }

      const profile = getProfile(chat.profileId);
      const settings = s.settings;

      // Rebuild the conversation path from the parent.
      const path = await activePath(chatId, parentMessageId);
      const userText = [...path].reverse().find((m) => m.role === 'user');
      const userTextStr = userText ? userText.parts.filter((p) => p.type === 'text').map((p) => (p as any).text).join('\n') : '';

      const system = await buildSystemPrompt(chat.profileId, profile.tools.includes('search_docs'), userTextStr);
      const messages: CoreMessage[] = [textMsg('system', system), ...toCoreMessages(path)];

      const abort = new AbortController();
      streamAbortRef = abort;

      s.startStream(chatId);
      s.setStepLabel(profile.emoji ? `${profile.emoji} ${profile.name}` : null);

      const started = performance.now();
      let firstTokenAt: number | null = null;

      // Turn log for faithful persistence: [{text, calls:[{chip, result}]}]
      const turns: { text: string; calls: { id: string; name: string; args: string; result?: ToolResultPart }[] }[] = [];
      let currentTurn: { text: string; calls: { id: string; name: string; args: string; result?: ToolResultPart }[] } = { text: '', calls: [] };

      try {
        await runAgentLoop({
          key,
          messages,
          toolNames: profile.tools.filter((t) => settings.enableTools[t] !== false),
          execCtx: {
            approveAllShell: settings.approveAllShell,
            requestApproval: (info) =>
              new Promise<boolean>((resolve) => {
                useAppStore.getState().setApproval({
                  ...info,
                  resolve: (ok) => {
                    useAppStore.getState().setApproval(null);
                    resolve(ok);
                  },
                });
              }),
            mcpServers: s.mcpServers.filter((m) => m.enabled),
          },
          temperature: settings.temperature ?? profile.temperature,
          maxTokens: settings.maxTokens,
          maxSteps: settings.maxSteps,
          signal: abort.signal,
          callbacks: {
            onStepStart: (stepN) => {
              if (stepN > 1) {
                // persist finished turn, start a new one
                if (currentTurn.text || currentTurn.calls.length) turns.push(currentTurn);
                currentTurn = { text: '', calls: [] };
              }
              useAppStore.getState().setStepLabel(stepN > 1 ? `گام ${stepN}` : useAppStore.getState().stepLabel);
            },
            onTextDelta: (d) => {
              if (firstTokenAt === null) firstTokenAt = performance.now();
              currentTurn.text += d;
              useAppStore.getState().appendStreamText(d);
            },
            onToolStart: (id, name) => {
              const chip: ToolChip = { id, name, args: '', status: 'running', summary: '' };
              useAppStore.getState().addChip(chip);
              currentTurn.calls.push({ id, name, args: '' });
            },
            onToolDelta: (id, argsDelta) => {
              const call = currentTurn.calls.find((c) => c.id === id);
              if (call) call.args += argsDelta;
              useAppStore.getState().patchChip(id, { args: (call?.args ?? '') });
            },
            onToolResult: (id, name, ok, denied) => {
              const call = currentTurn.calls.find((c) => c.id === id);
              const content = denied ? 'کاربر رد کرد' : ok ? 'انجام شد' : 'خطا';
              const chipUpdate: Partial<ToolChip> = { status: denied ? 'denied' : ok ? 'ok' : 'error' };
              if (call) {
                chipUpdate.summary = summarizeArgs(call.name, call.args);
                call.result = {
                  type: 'tool_result',
                  toolCallId: id,
                  name,
                  content: denied ? 'کاربر اجرای این فرمان را رد کرد.' : ok ? 'موفق' : 'خطا در اجرا',
                  isError: !ok,
                };
              }
              useAppStore.getState().patchChip(id, chipUpdate);
            },
            onDone: () => undefined,
          },
        });
      } finally {
        if (currentTurn.text || currentTurn.calls.length) turns.push(currentTurn);
        const finalStreamText = useAppStore.getState().streamText;
        const ttft = firstTokenAt ? Math.round(firstTokenAt - started) : undefined;

        // Persist the turn chain: for each iteration → assistant(+calls) then tool(results); final assistant carries the last text.
        let parentId = parentMessageId;
        for (let i = 0; i < turns.length; i++) {
          const t = turns[i];
          const parts: Part[] = [];
          if (t.text) parts.push({ type: 'text', text: t.text });
          for (const c of t.calls) {
            parts.push({ type: 'tool_call', id: c.id, name: c.name, args: c.args });
          }
          const isLast = i === turns.length - 1;
          if (parts.length) {
            const assistantMsg = await addMessage({
              id: genId('msg_'),
              chatId,
              parentId,
              role: 'assistant',
              parts,
              model: `${key.provider}/${key.model}`,
              ttftMs: i === 0 ? ttft : undefined,
            });
            parentId = assistantMsg.id;
          }
          const results = t.calls.filter((c) => c.result).map((c) => c.result!);
          if (results.length) {
            const toolMsg = await addMessage({
              id: genId('msg_'),
              chatId,
              parentId,
              role: 'tool',
              parts: results,
            });
            parentId = toolMsg.id;
          }
          if (isLast && !t.text && t.calls.length) {
            // model ended on a tool call with no closing text — nothing more to persist
            break;
          }
        }

        // If the loop produced no persisted assistant message at all (e.g. pure error),
        // persist the error text so the user sees what happened.
        if (!turns.length && finalStreamText) {
          await addMessage({
            id: genId('msg_'),
            chatId,
            parentId,
            role: 'assistant',
            parts: [{ type: 'text', text: finalStreamText }],
            model: `${key.provider}/${key.model}`,
            ttftMs: ttft,
          });
        }

        // Auto-title from first exchange.
        if (chat.title === 'گفتگوی جدید' && userTextStr) {
          const title = userTextStr.slice(0, 40).trim() + (userTextStr.length > 40 ? '…' : '');
          await db.chats.update(chatId, { title });
        }

        await logAudit('chat_turn', `مدل: ${key.provider}/${key.model}${ttft ? `، TTFT: ${ttft}ms` : ''}`);
        useAppStore.getState().endStream();
        streamAbortRef = null;
      }
    },
    [resolveKey, store],
  );

  /** Send a user message (with optional attachments) and run the agent. */
  const sendMessage = useCallback(
    async (chatId: string, text: string, attachments: { kind: 'image'; mimeType: string; data: string; name: string }[] = []) => {
      const db = await getDb();
      const chat = await db.chats.get(chatId);
      if (!chat) return;

      const parts: Part[] = [];
      const trimmed = text.trim();
      if (trimmed) parts.push({ type: 'text', text: trimmed });
      for (const a of attachments) {
        parts.push({ type: 'image', mimeType: a.mimeType, data: a.data, name: a.name });
      }
      if (!parts.length) return;

      const path = await activePath(chatId, chat.activeLeafId);
      const parentId = path.at(-1)?.id ?? null;

      await addMessage({ id: genId('msg_'), chatId, parentId, role: 'user', parts });
      await runTurn(chatId, (await db.chats.get(chatId))?.activeLeafId ?? null);
    },
    [runTurn],
  );

  /** Stop the current stream. */
  const stop = useCallback(() => {
    streamAbortRef?.abort();
  }, []);

  /** Regenerate: create a new assistant branch from the message's parent. */
  const regenerate = useCallback(
    async (messageId: string) => {
      const db = await getDb();
      const msg = await db.messages.get(messageId);
      if (!msg) return;
      await runTurn(msg.chatId, msg.parentId);
    },
    [runTurn],
  );

  /** Edit a user message → new branch sibling. */
  const editUserMessage = useCallback(
    async (messageId: string, newText: string) => {
      const db = await getDb();
      const msg = await db.messages.get(messageId);
      if (!msg || msg.role !== 'user') return;
      const newMsg = await addMessage({
        id: genId('msg_'),
        chatId: msg.chatId,
        parentId: msg.parentId,
        role: 'user',
        parts: [{ type: 'text', text: newText }],
      });
      await runTurn(msg.chatId, newMsg.id);
    },
    [runTurn],
  );

  /** Switch to a sibling branch (e.g. an earlier regeneration). */
  const switchBranch = useCallback(async (messageId: string) => {
    const db = await getDb();
    const msg = await db.messages.get(messageId);
    if (!msg) return;
    await db.chats.update(msg.chatId, { activeLeafId: msg.id });
    bump();
  }, []);

  return { sendMessage, stop, regenerate, editUserMessage, switchBranch, resolveKey };
}

/* module-level abort handle */
let streamAbortRef: AbortController | null = null;
