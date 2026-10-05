'use client';

/**
 * Zustand store — ephemeral UI + streaming state.
 * Durable data (chats/messages/etc.) lives in IndexedDB and is read via
 * dexie-react-hooks; the vault keys live in memory after unlock.
 */
import { create } from 'zustand';
import type { KeyEntry, McpServerRec, AppSettings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { getSetting, setSetting } from '@/lib/idb';

export interface ToolChip {
  id: string;
  name: string;
  args: string;
  status: 'calling' | 'running' | 'ok' | 'error' | 'denied';
  summary?: string;
}

export interface ApprovalRequest {
  toolName: string;
  summary: string;
  detail: string;
  resolve: (ok: boolean) => void;
}

export type DialogKind = 'settings-keys' | 'settings-general' | 'settings-security' | 'settings-mcp' | null;

interface AppState {
  /* vault / keys */
  keys: KeyEntry[];
  vaultState: 'loading' | 'locked' | 'unlocked' | 'empty';
  setKeys: (keys: KeyEntry[]) => void;
  setVaultState: (s: AppState['vaultState']) => void;

  /* settings */
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  /* mcp */
  mcpServers: McpServerRec[];
  setMcpServers: (s: McpServerRec[]) => void;

  /* active chat session */
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;

  /* streaming */
  isStreaming: boolean;
  streamText: string;
  streamChatId: string | null;
  toolChips: ToolChip[];
  stepLabel: string | null;
  startStream: (chatId: string) => void;
  appendStreamText: (delta: string) => void;
  addChip: (chip: ToolChip) => void;
  patchChip: (id: string, patch: Partial<ToolChip>) => void;
  clearChips: () => void;
  setStepLabel: (label: string | null) => void;
  endStream: () => void;

  /* dialogs */
  dialog: DialogKind;
  openDialog: (d: DialogKind) => void;
  approval: ApprovalRequest | null;
  setApproval: (a: ApprovalRequest | null) => void;

  /* panel */
  panelOpen: boolean;
  togglePanel: () => void;

  /* db tick — bumped after every IndexedDB mutation so live queries re-run
     deterministically (Dexie observation can be lost across native awaits). */
  dbTick: number;
  bumpDb: () => void;

  /* search */
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  keys: [],
  vaultState: 'loading',
  setKeys: (keys) =>
    set({ keys, vaultState: keys.length ? 'unlocked' : get().vaultState === 'locked' ? 'locked' : 'empty' }),
  setVaultState: (vaultState) => set({ vaultState }),

  settings: DEFAULT_SETTINGS,
  loadSettings: async () => {
    const stored = (await getSetting<AppSettings>('settings')) ?? {};
    set({ settings: { ...DEFAULT_SETTINGS, ...stored } });
  },
  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await setSetting('settings', next);
  },

  mcpServers: [],
  setMcpServers: (mcpServers) => set({ mcpServers }),

  activeChatId: null,
  setActiveChatId: (activeChatId) => set({ activeChatId }),

  isStreaming: false,
  streamText: '',
  streamChatId: null,
  toolChips: [],
  stepLabel: null,
  startStream: (chatId) => set({ isStreaming: true, streamText: '', toolChips: [], streamChatId: chatId, stepLabel: null }),
  appendStreamText: (delta) => set((s) => ({ streamText: s.streamText + delta })),
  addChip: (chip) => set((s) => ({ toolChips: [...s.toolChips, chip] })),
  patchChip: (id, patch) =>
    set((s) => ({ toolChips: s.toolChips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  clearChips: () => set({ toolChips: [] }),
  setStepLabel: (stepLabel) => set({ stepLabel }),
  endStream: () => set({ isStreaming: false, streamChatId: null, stepLabel: null }),

  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  approval: null,
  setApproval: (approval) => set({ approval }),

  panelOpen: false,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  dbTick: 0,
  bumpDb: () => set((s) => ({ dbTick: s.dbTick + 1 })),

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
