'use client';

/**
 * AgentPanel — right panel: ابزارها (toggles), فایل‌های پوشه کاری, حافظه بلندمدت,
 * اسناد RAG, حسابرسی. Hidden on small screens unless toggled.
 */
import { useCallback, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Wrench, FolderTree, Brain, FileText, ScrollText, Trash2, Plus, RefreshCw, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getDb, logAudit } from '@/lib/idb';
import { deleteDocument } from '@/lib/rag';
import { useAppStore } from '@/components/hooshiyar/store';
import { TOOL_IDS, TOOL_PERSIAN_NAMES, SENSITIVE_TOOLS } from '@/lib/agent/tools';
import { faDateTime, faRelative, formatBytes } from '@/lib/persian';
import type { ToolId } from '@/lib/agent/tools';
import { cn } from '@/lib/utils';

export function AgentPanel() {
  const panelOpen = useAppStore((s) => s.panelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);

  return (
    <aside
      className={cn(
        'h-full shrink-0 flex-col border-s border-border/70 bg-card/60 backdrop-blur',
        panelOpen ? 'fixed inset-y-0 end-0 z-40 flex w-80 shadow-xl lg:static lg:z-auto lg:w-72 lg:shadow-none' : 'hidden',
      )}
      aria-label="پنل عامل"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <h2 className="text-sm font-bold">پنل عامل</h2>
        <Button variant="ghost" size="icon" className="size-7" onClick={togglePanel} aria-label="بستن پنل">
          <X className="size-4" />
        </Button>
      </div>

      <Tabs defaultValue="tools" dir="rtl" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="grid w-full grid-cols-5 rounded-none border-b border-border/60 bg-transparent p-0">
          {[
            ['tools', 'ابزار', Wrench],
            ['files', 'فایل', FolderTree],
            ['memory', 'حافظه', Brain],
            ['docs', 'اسناد', FileText],
            ['audit', 'گزارش', ScrollText],
          ].map(([value, label, Icon]: any) => (
            <TabsTrigger key={value} value={value} className="relative h-9 gap-1 rounded-none text-[11px] data-[state=active]:bg-card" aria-label={label}>
              <Icon className="size-3.5" />
              <span className="hidden xl:inline">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="tools" className="m-0 p-4"><ToolsTab /></TabsContent>
          <TabsContent value="files" className="m-0 p-4"><FilesTab /></TabsContent>
          <TabsContent value="memory" className="m-0 p-4"><MemoryTab /></TabsContent>
          <TabsContent value="docs" className="m-0 p-4"><DocsTab /></TabsContent>
          <TabsContent value="audit" className="m-0 p-4"><AuditTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

/* ---------------------------------- tools ---------------------------------- */

function ToolsTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const toggle = (id: ToolId, v: boolean) => {
    updateSettings({ enableTools: { ...settings.enableTools, [id]: v } });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
        ابزارهای فعال در دسترس عامل قرار می‌گیرند. فرمان شل همیشه نیازمند تأیید شماست.
      </p>
      {TOOL_IDS.map((id) => (
        <label
          key={id}
          className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
        >
          <span className="flex items-center gap-2 text-xs">
            <span className="text-sm" aria-hidden>
              {{ web_search: '🌐', web_fetch: '📄', run_js: '⚡', run_python: '🐍', run_shell: '⌨️', read_file: '📖', write_file: '✍️', list_files: '🗂️', search_docs: '🔎', remember: '🧠' }[id]}
            </span>
            {TOOL_PERSIAN_NAMES[id]}
            {SENSITIVE_TOOLS.has(id) && <Badge variant="outline" className="text-[9px] text-amber-600">حساس</Badge>}
          </span>
          <Switch
            checked={settings.enableTools[id] !== false}
            onCheckedChange={(v) => toggle(id, v)}
            aria-label={TOOL_PERSIAN_NAMES[id]}
          />
        </label>
      ))}
    </div>
  );
}

/* ---------------------------------- files ---------------------------------- */

interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
}

function FilesTab() {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'list', path: '' }),
      });
      const json = await res.json();
      setFiles(json.files ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  if (files === null && !loading) refresh();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">پوشه کاری سندباکس روی سرور</p>
        <Button variant="ghost" size="icon" className="size-7" onClick={refresh} aria-label="به‌روزرسانی">
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      {files?.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">پوشه کاری خالی است. از عامل بخواهید فایلی بسازد.</p>}
      <div className="flex flex-col gap-1">
        {files?.map((f) => (
          <div key={f.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[11px] hover:bg-muted/60" dir="ltr">
            <span aria-hidden>{f.type === 'dir' ? '📁' : '📄'}</span>
            <span className="min-w-0 flex-1 truncate">{f.path}</span>
            {f.type === 'file' && <span className="shrink-0 text-[9px] text-muted-foreground">{formatBytes(f.size)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- memory --------------------------------- */

function MemoryTab() {
  const dbTick = useAppStore((s) => s.dbTick);
  const memories = useLiveQuery(async () => {
    const db = await getDb();
    return db.memories.orderBy('createdAt').reverse().limit(100).toArray();
  }, [dbTick], undefined);
  const [newMemory, setNewMemory] = useState('');

  const add = async () => {
    if (!newMemory.trim()) return;
    const db = await getDb();
    await db.memories.add({ id: crypto.randomUUID(), text: newMemory.trim(), source: 'manual', createdAt: Date.now() });
    await logAudit('memory_manual_add', newMemory.trim().slice(0, 200));
    setNewMemory('');
    toast.success('به حافظه اضافه شد');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={newMemory}
          onChange={(e) => setNewMemory(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="مثلاً: نام من … است؛ به پایتون علاقه دارم"
          className="h-9 text-xs"
        />
        <Button size="icon" className="size-9 shrink-0" onClick={add} aria-label="افزودن حافظه">
          <Plus className="size-4" />
        </Button>
      </div>
      {memories?.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">حافظه خالی است. عامل هم می‌تواند با ابزار remember چیزی به یاد بسپارد.</p>}
      {memories?.map((m) => (
        <div key={m.id} className="group rounded-lg border border-border/60 bg-card p-2.5">
          <p className="text-xs leading-5">{m.text}</p>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{m.source === 'agent' ? '🤖 ثبت‌شده توسط عامل' : '✍️ دستی'} · {faRelative(m.createdAt)}</span>
            <button
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={async () => {
                (await getDb()).memories.delete(m.id);
                useAppStore.getState().bumpDb();
              }}
              aria-label="حذف حافظه"
            >
              <Trash2 className="size-3 hover:text-destructive" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- docs ---------------------------------- */

function DocsTab() {
  const dbTick = useAppStore((s) => s.dbTick);
  const docs = useLiveQuery(async () => {
    const db = await getDb();
    return db.documents.orderBy('addedAt').reverse().toArray();
  }, [dbTick], undefined);
  const [busy, setBusy] = useState(false);

  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.txt,.md,.markdown,.json,.csv,.tsv,.js,.ts,.py,.html,.xml,.yaml,.yml,.log';
    input.onchange = async () => {
      for (const file of Array.from(input.files ?? [])) {
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          const { addDocument } = await import('@/lib/rag');
          const doc = await addDocument(file.name, json.text, json.mime, file.size);
          await logAudit('doc_added', `${file.name} (${doc.chunks} قطعه)`);
          toast.success(`«${file.name}»: ${doc.chunks} قطعه فهرست‌بندی شد`);
        } catch (e: any) {
          toast.error(`«${file.name}»: ${e?.message ?? e}`);
        } finally {
          setBusy(false);
        }
      }
    };
    input.click();
  };

  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={upload} disabled={busy}>
        <Plus className="size-4" /> افزودن سند (PDF / متن / کد)
      </Button>
      {docs?.length === 0 && (
        <p className="py-4 text-center text-xs leading-5 text-muted-foreground">
          سندی نیست. اسناد را بارگذاری کنید تا عامل با ابزار «جستجو در اسناد» از آن‌ها استفاده کند (فهرست‌بندی BM25 محلی).
        </p>
      )}
      {docs?.map((d) => (
        <div key={d.id} className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
          <FileText className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{d.name}</div>
            <div className="text-[10px] text-muted-foreground">{d.chunks} قطعه · {formatBytes(d.size)} · {faRelative(d.addedAt)}</div>
          </div>
          <button
            onClick={async () => {
              await deleteDocument(d.id);
              useAppStore.getState().bumpDb();
              toast.success('سند حذف شد');
            }}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`حذف سند ${d.name}`}
          >
            <Trash2 className="size-3.5 hover:text-destructive" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- audit ---------------------------------- */

function AuditTab() {
  const dbTick = useAppStore((s) => s.dbTick);
  const logs = useLiveQuery(async () => {
    const db = await getDb();
    return db.audit.orderBy('ts').reverse().limit(120).toArray();
  }, [dbTick], undefined);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">ثبت اقدامات حساس عامل (فرمان شل، نوشتن فایل، ابزارها)</p>
      {logs?.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">گزارشی ثبت نشده است.</p>}
      {logs?.map((l) => (
        <div key={l.id} className="rounded-lg border border-border/60 bg-card px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
            <span
              className={cn(
                'size-1.5 rounded-full',
                l.status === 'ok' ? 'bg-emerald-500' :
                l.status === 'error' ? 'bg-destructive' :
                l.status === 'denied' ? 'bg-amber-500' :
                'bg-muted-foreground',
              )}
              aria-hidden
            />
            {l.action}
            <span className="ms-auto font-normal text-[9px] text-muted-foreground">{faDateTime(l.ts)}</span>
          </div>
          <p className="mt-0.5 line-clamp-3 break-all font-mono text-[10px] leading-4 text-muted-foreground" dir="auto">{l.detail}</p>
        </div>
      ))}
    </div>
  );
}
