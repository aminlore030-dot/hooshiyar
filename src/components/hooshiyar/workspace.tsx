'use client';

/**
 * Workspace — the app shell: theme provider, sidebar, chat area, agent panel,
 * settings dialog, approval dialog, onboarding.
 * Sticky footer guaranteed by min-h-screen flex-col + mt-auto.
 */
import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, getSetting, setSetting } from '@/lib/idb';
import { getKeys, hasVault, isPlainVault } from '@/lib/vault';
import { ensureCapability } from '@/lib/client/capability';
import { useAppStore } from '@/components/hooshiyar/store';
import { Sidebar } from '@/components/hooshiyar/sidebar';
import { ChatView } from '@/components/hooshiyar/chat-view';
import { AgentPanel } from '@/components/hooshiyar/agent-panel';
import { SettingsDialog } from '@/components/hooshiyar/settings-dialog';
import { ApprovalDialog } from '@/components/hooshiyar/approval-dialog';
import { OnboardingDialog } from '@/components/hooshiyar/onboarding';
import { VaultUnlockDialog } from '@/components/hooshiyar/vault-unlock';
import type { McpServerRec } from '@/lib/types';

export function Workspace() {
  const vaultState = useAppStore((s) => s.vaultState);
  const setKeys = useAppStore((s) => s.setKeys);
  const setVaultState = useAppStore((s) => s.setVaultState);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const setMcpServers = useAppStore((s) => s.setMcpServers);
  const dialog = useAppStore((s) => s.dialog);

  const mcpServers = useLiveQuery(async () => (await getDb()).mcpServers.toArray(), [], undefined as McpServerRec[] | undefined);

  /* boot sequence */
  useEffect(() => {
    (async () => {
      // Capability token for the dangerous tool routes (/api/tools/*, /api/files,
      // /api/upload, /api/mcp-proxy). Fetched once; failures just mean those
      // tools will be refused until the page reloads.
      void ensureCapability();

      await loadSettings();
      const storedMcp = await getSetting<McpServerRec[]>('mcpServers');
      if (storedMcp?.length) setMcpServers(storedMcp);

      // Auto-select the most recent chat (if any).
      try {
        const db = await getDb();
        const latest = await db.chats.orderBy('updatedAt').reverse().limit(1).toArray();
        if (latest[0]) useAppStore.getState().setActiveChatId(latest[0].id);
      } catch {
        /* db not ready yet */
      }

      if (!hasVault()) {
        setVaultState('empty');
        return;
      }
      if (isPlainVault()) {
        // Obfuscated (no-passphrase) vault — load directly.
        setKeys(getKeys());
        setVaultState('unlocked');
      } else {
        setVaultState('locked');
      }
    })();
  }, [loadSettings, setKeys, setVaultState, setMcpServers]);

  useEffect(() => {
    if (mcpServers) setMcpServers(mcpServers);
  }, [mcpServers, setMcpServers]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <div className="flex h-screen flex-col overflow-hidden bg-background" dir="rtl">
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col" aria-label="محل گفتگو">
            <ChatView />
          </main>
          <AgentPanel />
        </div>

        {/* Sticky footer — always at the bottom, respects safe areas */}
        <footer className="mt-auto border-t border-border/60 bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/50">
          <div className="mx-auto flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-muted-foreground pb-[max(6px,env(safe-area-inset-bottom))]">
            <span>
              هوش‌یار — ایستگاه کاری هوش مصنوعی شخصی · کلیدها فقط در مرورگر شما ذخیره می‌شوند
            </span>
            <span className="hidden sm:inline">محلی‌سازی کامل · RTL · IndexedDB</span>
          </div>
        </footer>

        <SettingsDialog open={dialog !== null} />
        <ApprovalDialog />
        <OnboardingDialog />
        {vaultState === 'locked' && <VaultUnlockDialog />}
      </div>
    </ThemeProvider>
  );
}


