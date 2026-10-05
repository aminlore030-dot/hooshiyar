'use client';

/**
 * ChatView — header (profile/model/team controls) + virtualized message list
 * + streaming bubble + composer.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PanelRight, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getDb } from '@/lib/idb';
import { useAppStore } from '@/components/hooshiyar/store';
import { useChatSession } from '@/components/hooshiyar/use-chat-session';
import { MessageItem } from '@/components/hooshiyar/message-item';
import { StreamingBubble } from '@/components/hooshiyar/streaming-bubble';
import { Composer } from '@/components/hooshiyar/composer';
import { PROFILES } from '@/lib/agent/profiles';
import { providerName } from '@/lib/providers/registry';
import type { ChatRec, StoredMessage } from '@/lib/types';

export function ChatView() {
  const activeChatId = useAppStore((s) => s.activeChatId);
  const isStreaming = useAppStore((s) => s.isStreaming);
  const streamChatId = useAppStore((s) => s.streamChatId);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const setActiveChatId = useAppStore((s) => s.setActiveChatId);
  const dbTick = useAppStore((s) => s.dbTick);
  const { regenerate, switchBranch, sendMessage, editUserMessage } = useChatSession();

  const chat = useLiveQuery(
    async () => (activeChatId ? (await getDb()).chats.get(activeChatId) : undefined),
    [activeChatId, dbTick],
    undefined,
  );

  const messages = useLiveQuery(
    async () => {
      if (!activeChatId) return [] as StoredMessage[];
      const db = await getDb();
      const { activePath } = await import('@/lib/idb');
      return activePath(activeChatId, chat?.activeLeafId ?? null);
    },
    [activeChatId, chat?.activeLeafId, dbTick],
    undefined,
  );

  const siblingsMap = useLiveQuery(
    async () => {
      if (!activeChatId) return {} as Record<string, string[]>;
      const db = await getDb();
      const all = await db.messages.where('chatId').equals(activeChatId).toArray();
      const map: Record<string, string[]> = {};
      for (const m of all) {
        const key = `${m.parentId ?? 'root'}|${m.role}`;
        (map[key] ??= []).push(m.id);
      }
      // keep only entries with siblings
      return Object.fromEntries(Object.entries(map).filter(([, ids]) => ids.length > 1));
    },
    [activeChatId, dbTick],
    undefined,
  );

  /* virtualizer */
  const scrollRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => messages ?? [], [messages]);
  const showStreamBubble = isStreaming && streamChatId === activeChatId;

  const virtualizer = useVirtualizer({
    count: list.length + (showStreamBubble ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 6,
    getItemKey: (i) => (i < list.length ? list[i].id : '__streaming__'),
  });

  /* autoscroll: pin to bottom on new content while the user is near bottom.
     Uses direct scrollTop (virtualizer estimates undershoot scrollToIndex),
     plus a rAF loop while streaming so growing text stays pinned. */
  const stickToBottom = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }, []);
  useEffect(() => {
    if (stickToBottom.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [list.length, showStreamBubble]);
  useEffect(() => {
    if (!showStreamBubble) return;
    let raf = 0;
    let cancelled = false;
    const pin = () => {
      if (cancelled) return;
      const el = scrollRef.current;
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
      raf = requestAnimationFrame(pin);
    };
    raf = requestAnimationFrame(pin);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [showStreamBubble]);

  /* empty state: no chat selected */
  if (!activeChatId || !chat) {
    return <EmptyWorkspace onPick={async () => {}} />;
  }

  const updateChat = (patch: Partial<ChatRec>) => {
    getDb().then((db) => db.chats.update(chat.id, { ...patch, updatedAt: Date.now() }));
  };

  const handleRegenerate = async (msgId: string) => {
    if (isStreaming) return;
    await regenerate(msgId);
  };

  const handleEdit = async (msgId: string, newText: string) => {
    if (isStreaming) return;
    await editUserMessage(msgId, newText);
  };

  return (
    <TooltipProvider delayDuration={300}>
      {/* header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/40 px-3 py-2 backdrop-blur">
        <Select value={chat.profileId} onValueChange={(v) => updateChat({ profileId: v })}>
          <SelectTrigger className="h-8 w-[150px] gap-1 text-xs" aria-label="شخصیت عامل">
            <Sparkles className="size-3.5 text-primary" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILES.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.emoji} {p.name} — <span className="text-muted-foreground">{p.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ModelSelector chat={chat} onChange={(keyId, model) => updateChat({ keyId, model })} />

        <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2 py-1">
          <Users className="size-3.5 text-amber-500" aria-hidden />
          <Label htmlFor="team-mode" className="cursor-pointer text-[11px] text-muted-foreground">حالت تیم</Label>
          <Switch
            id="team-mode"
            checked={chat.teamMode}
            onCheckedChange={(v) => {
              updateChat({ teamMode: v });
              toast(v ? 'حالت تیم فعال شد: برنامه‌ریز، مجری و منتقد' : 'حالت تیم خاموش شد');
            }}
            className="scale-90"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className={`ms-auto size-8 lg:hidden ${panelOpen ? 'text-primary' : ''}`}
          onClick={togglePanel}
          aria-label="پنل عامل"
        >
          <PanelRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`hidden size-8 lg:inline-flex ${panelOpen ? 'text-primary' : ''}`}
          onClick={togglePanel}
          aria-label="پنل عامل"
        >
          <PanelRight className="size-4" />
        </Button>
      </header>

      {/* messages */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="پیام‌های گفتگو">
        {list.length === 0 && !showStreamBubble ? (
          <EmptyChat chat={chat} onSend={(text) => sendMessage(chat.id, text)} />
        ) : (
          <div className="mx-auto max-w-3xl px-3 py-4" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const isStream = vi.index >= list.length;
              const msg = isStream ? null : list[vi.index];
              return (
                <div
                  key={vi.key}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  className="absolute inset-x-3 px-0 pb-1"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {msg ? (
                    <MessageItem
                      message={msg}
                      siblingIds={siblingsMap?.[`${msg.parentId ?? 'root'}|${msg.role}`] ?? []}
                      onSwitchBranch={switchBranch}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEdit}
                    />
                  ) : (
                    <StreamingBubble />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* composer */}
      <Composer chat={chat} />
    </TooltipProvider>
  );
}

/* ------------------------------ model selector ------------------------------ */

function ModelSelector({ chat, onChange }: { chat: ChatRec; onChange: (keyId: string | null, model: string) => void }) {
  const keys = useAppStore((s) => s.keys);
  const openDialog = useAppStore((s) => s.openDialog);

  if (!keys.length) {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-amber-600" onClick={() => openDialog('settings-keys')}>
        ⚠️ کلیدی تنظیم نشده — افزودن کلید
      </Button>
    );
  }

  return (
    <Select
      value={chat.keyId ?? keys[0]?.id}
      onValueChange={(id) => {
        const k = keys.find((x) => x.id === id);
        if (k) onChange(k.id, k.model);
      }}
    >
      <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="انتخاب مدل">
        <SelectValue placeholder="مدل" />
      </SelectTrigger>
      <SelectContent>
        {keys.map((k) => (
          <SelectItem key={k.id} value={k.id} className="text-xs">
            {providerName(k.provider)} · {k.model || 'بدون مدل'} · {k.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------ empty states ------------------------------ */

function EmptyWorkspace({ onPick }: { onPick: () => void }) {
  void onPick;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-3xl">🪶</div>
      <h1 className="text-lg font-extrabold">به هوش‌یار خوش آمدید</h1>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        یک گفتگوی جدید بسازید تا شروع کنید. اگر کلید API ندارید، ارائه‌دهنده دمو بدون کلید در دسترس است.
      </p>
    </div>
  );
}

function EmptyChat({ chat, onSend }: { chat: ChatRec; onSend: (text: string) => void }) {
  const profile = PROFILES.find((p) => p.id === chat.profileId) ?? PROFILES[0];
  const suggestions = [
    'وضعیت امروز بورس تهران را خلاصه کن',
    'یک اسکریپت پایتون بنویس که نام فایل‌های یک پوشه را مرتب کند',
    '۱۲ ضربدر ۹۹ را محاسبه کن و مراحل را نشان بده',
    'برای یادگیری زبان فرانسه یک برنامه هفتگی بریز',
  ];
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl" aria-hidden>{profile.emoji}</div>
      <div>
        <h2 className="text-base font-bold">{profile.name} آماده است</h2>
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{profile.description}</p>
      </div>
      <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSend(s)}
            className="rounded-xl border border-border/70 bg-card px-3 py-2.5 text-xs leading-5 transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
