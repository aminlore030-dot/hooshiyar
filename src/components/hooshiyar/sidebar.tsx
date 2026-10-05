'use client';

/**
 * Sidebar — chat list, folders, tags, search, new chat, import/export,
 * settings entry and theme toggle.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  FolderPlus, MessageSquarePlus, Search, Settings, Sun, Moon, Trash2, Pencil,
  FolderOpen, Folder, Download, Upload, Tags, PanelRight, LockKeyhole, Pin,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { getDb, wipeChat, exportAllData, importAllData } from '@/lib/idb';
import { useAppStore } from '@/components/hooshiyar/store';
import { createChat } from '@/components/hooshiyar/use-chat-session';
import { getProfile } from '@/lib/agent/profiles';
import { faRelative } from '@/lib/persian';
import type { ChatRec, FolderRec } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const activeChatId = useAppStore((s) => s.activeChatId);
  const setActiveChatId = useAppStore((s) => s.setActiveChatId);
  const openDialog = useAppStore((s) => s.openDialog);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const keys = useAppStore((s) => s.keys);
  const vaultState = useAppStore((s) => s.vaultState);
  const dbTick = useAppStore((s) => s.dbTick);
  const { resolvedTheme, setTheme } = useTheme();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const chats = useLiveQuery(async () => {
    const db = await getDb();
    const all = await db.chats.toArray();
    return all.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [dbTick], undefined);

  const folders = useLiveQuery(async () => (await getDb()).folders.toArray(), [dbTick], undefined);

  const filtered = useMemo(() => {
    let list: ChatRec[] = chats ?? [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((c) => c.title.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)));
    }
    return list;
  }, [chats, searchQuery]);

  const rootChats = filtered.filter((c) => !c.folderId);
  const byFolder = useMemo(() => {
    const m = new Map<string, ChatRec[]>();
    for (const c of filtered) if (c.folderId) m.set(c.folderId, [...(m.get(c.folderId) ?? []), c]);
    return m;
  }, [filtered]);

  const handleNewChat = async () => {
    const keyId = keys[0]?.id ?? null;
    const model = keys[0]?.model ?? '';
    const id = await createChat({ keyId, model });
    setActiveChatId(id);
  };

  const addFolder = async () => {
    const name = window.prompt('نام پوشه را وارد کنید:');
    if (!name?.trim()) return;
    const db = await getDb();
    await db.folders.add({ id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() });
    useAppStore.getState().bumpDb();
    toast.success('پوشه ساخته شد');
  };

  const renameFolder = async (f: FolderRec) => {
    const name = window.prompt('نام جدید پوشه:', f.name);
    if (!name?.trim()) return;
    const db = await getDb();
    await db.folders.update(f.id, { name: name.trim() });
    useAppStore.getState().bumpDb();
  };

  const deleteFolder = async (f: FolderRec) => {
    if (!window.confirm(`پوشه «${f.name}» حذف شود؟ گفتگوها حفظ می‌شوند.`)) return;
    const db = await getDb();
    await db.transaction('rw', db.folders, db.chats, async () => {
      await db.chats.where('folderId').equals(f.id).modify({ folderId: null });
      await db.folders.delete(f.id);
    });
    useAppStore.getState().bumpDb();
  };

  const deleteChat = async (chat: ChatRec) => {
    await wipeChat(chat.id);
    if (activeChatId === chat.id) setActiveChatId(null);
    toast.success('گفتگو حذف شد');
  };

  const togglePin = async (chat: ChatRec) => {
    const db = await getDb();
    await db.chats.update(chat.id, { pinned: !chat.pinned });
    useAppStore.getState().bumpDb();
  };

  const exportData = async () => {
    const json = await exportAllData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hooshiyar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('پشتیبان‌گیری انجام شد');
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const summary = await importAllData(await file.text());
        toast.success(`بازیابی شد: ${summary.chats} گفتگو، ${summary.messages} پیام`);
      } catch (e: any) {
        toast.error(`بازیابی ناموفق: ${e?.message ?? e}`);
      }
    };
    input.click();
  };

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderChatRow = (chat: ChatRec) => (
    <div
      key={chat.id}
      role="button"
      tabIndex={0}
      aria-current={activeChatId === chat.id}
      onClick={() => setActiveChatId(chat.id)}
      onKeyDown={(e) => e.key === 'Enter' && setActiveChatId(chat.id)}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition-colors',
        activeChatId === chat.id ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-muted/70',
      )}
    >
      <span className="text-base leading-none" aria-hidden>{getProfile(chat.profileId).emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {chat.pinned && <Pin className="size-3 shrink-0 text-amber-500" aria-hidden />}
          <span className="truncate font-medium">{chat.title}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{faRelative(chat.updatedAt)}</span>
          {chat.teamMode && <Badge variant="outline" className="h-4 px-1 text-[9px]">تیم</Badge>}
          {chat.tags.slice(0, 1).map((t) => (
            <Badge key={t} variant="secondary" className="h-4 gap-0.5 px-1 text-[9px]">
              <Tags className="size-2.5" aria-hidden />{t}
            </Badge>
          ))}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            aria-label="عملیات گفتگو"
            onClick={(e) => e.stopPropagation()}
          >
            <Pencil className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => {
            const t = window.prompt('عنوان جدید گفتگو:', chat.title);
            if (t?.trim()) getDb().then((db) => db.chats.update(chat.id, { title: t.trim() })).then(() => useAppStore.getState().bumpDb());
          }}>
            <Pencil className="size-3.5" /> تغییر عنوان
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            const t = window.prompt('برچسب‌ها را با ویرگول جدا کنید:', chat.tags.join('، '));
            if (t !== null) {
              const tags = t.split(/[،,]/).map((x) => x.trim()).filter(Boolean);
              getDb().then((db) => db.chats.update(chat.id, { tags })).then(() => useAppStore.getState().bumpDb());
            }
          }}>
            <Tags className="size-3.5" /> برچسب‌ها
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => togglePin(chat)}>
            <Pin className="size-3.5" /> {chat.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن'}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteChat(chat)}>
            <Trash2 className="size-3.5" /> حذف گفتگو
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className="flex h-full w-16 flex-col border-e border-sidebar-border bg-sidebar md:w-72"
        aria-label="فهرست گفتگوها"
      >
        {/* brand */}
        <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-lg font-black text-primary-foreground shadow-sm">
            هـ
          </div>
          <div className="hidden min-w-0 md:block">
            <div className="truncate text-sm font-extrabold">هوش‌یار</div>
            <div className="truncate text-[10px] text-muted-foreground">ایستگاه کاری هوش مصنوعی شخصی</div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="ms-auto hidden size-8 md:inline-flex" onClick={() => useAppStore.getState().togglePanel()} aria-label="پنل عامل">
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>پنل عامل</TooltipContent>
          </Tooltip>
        </div>

        {/* actions */}
        <div className="flex items-center gap-1.5 px-2 pt-2.5 md:px-3">
          <Button onClick={handleNewChat} className="h-9 flex-1 gap-1.5 text-xs md:text-sm" aria-label="گفتگوی جدید">
            <MessageSquarePlus className="size-4" />
            <span className="hidden md:inline">گفتگوی جدید</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={addFolder} aria-label="پوشه جدید">
                <FolderPlus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>پوشه جدید</TooltipContent>
          </Tooltip>
        </div>

        {/* search */}
        <div className="relative px-2 pt-2 md:px-3">
          <Search className="pointer-events-none absolute start-4.5 top-2.9 size-3.5 -translate-y-0 text-muted-foreground md:start-5" aria-hidden />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جستجو…"
            className="h-8 bg-card ps-7 text-xs md:text-sm"
            aria-label="جستجوی گفتگوها"
          />
        </div>

        {/* list */}
        <ScrollArea className="min-h-0 flex-1 px-1.5 py-2">
          <nav className="flex flex-col gap-0.5" aria-label="گفتگوها">
            {folders?.map((f) => (
              <div key={f.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleFolder(f.id)}
                  onKeyDown={(e) => e.key === 'Enter' && toggleFolder(f.id)}
                  className="group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/70"
                >
                  {expandedFolders.has(f.id) ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
                  <span className="truncate">{f.name}</span>
                  <span className="text-[9px]">({byFolder.get(f.id)?.length ?? 0})</span>
                  <span className="ms-auto hidden gap-0.5 group-hover:flex">
                    <button
                      className="rounded p-0.5 hover:text-foreground"
                      aria-label="تغییر نام پوشه"
                      onClick={(e) => { e.stopPropagation(); renameFolder(f); }}
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      className="rounded p-0.5 hover:text-destructive"
                      aria-label="حذف پوشه"
                      onClick={(e) => { e.stopPropagation(); deleteFolder(f); }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                </div>
                {expandedFolders.has(f.id) && byFolder.get(f.id)?.map(renderChatRow)}
              </div>
            ))}
            {rootChats.map(renderChatRow)}
            {chats && !chats.length && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                هنوز گفتگویی نیست.
                <br />
                دکمه «گفتگوی جدید» را بزنید.
              </p>
            )}
          </nav>
        </ScrollArea>

        {/* footer actions */}
        <div className="flex items-center justify-between gap-1 border-t border-sidebar-border px-2 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => openDialog('settings-keys')}
                aria-label="تنظیمات و کلیدها"
              >
                {vaultState === 'locked' ? <LockKeyhole className="size-4 text-amber-500" /> : <Settings className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>تنظیمات و کلیدها {keys.length ? `(${keys.length} کلید)` : ''}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                aria-label="تغییر پوسته"
              >
                {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>روشن / تاریک</TooltipContent>
          </Tooltip>
          <div className="ms-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={exportData} aria-label="خروجی گرفتن">
                  <Download className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>خروجی داده‌ها</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={importData} aria-label="ورود داده‌ها">
                  <Upload className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>بازیابی پشتیبان</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
