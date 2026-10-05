'use client';

/**
 * MessageItem — a single message in the tree: markdown rendering, tool chips,
 * copy/edit/regenerate/branch actions, TTS, add-to-memory.
 */
import { memo, useMemo, useState } from 'react';
import {
  Check, Copy, Pencil, RefreshCw, Volume2, Brain, GitBranch, Wrench,
  Loader2, CircleCheck, CircleX, Ban, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Markdown } from '@/components/hooshiyar/markdown';
import { getDb } from '@/lib/idb';
import { faTime } from '@/lib/persian';
import { TOOL_PERSIAN_NAMES } from '@/lib/agent/tools';
import { useAppStore, type ToolChip } from '@/components/hooshiyar/store';
import { partsText } from '@/lib/types';
import type { StoredMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

/* -------------------------------- tool chips -------------------------------- */

const TOOL_ICONS: Record<string, string> = {
  web_search: '🌐', web_fetch: '📄', run_js: '⚡', run_python: '🐍', run_shell: '⌨️',
  read_file: '📖', write_file: '✍️', list_files: '🗂️', search_docs: '🔎', remember: '🧠',
};

export function ToolChipRow({ chip }: { chip: ToolChip }) {
  const [open, setOpen] = useState(false);
  const icon = TOOL_ICONS[chip.name] ?? '🔧';
  /** MCP tools carry mcp__serverId__toolName — show the friendly tail. */
  const friendlyName = chip.name.startsWith('mcp__')
    ? TOOL_PERSIAN_NAMES[chip.name.split('__').pop() as keyof typeof TOOL_PERSIAN_NAMES] ?? chip.name.split('__').pop()
    : TOOL_PERSIAN_NAMES[chip.name as keyof typeof TOOL_PERSIAN_NAMES] ?? chip.name;
  const label = friendlyName;
  const statusIcon =
    chip.status === 'running' ? <Loader2 className="size-3 animate-spin" /> :
    chip.status === 'ok' ? <CircleCheck className="size-3 text-emerald-600" /> :
    chip.status === 'denied' ? <Ban className="size-3 text-amber-600" /> :
    chip.status === 'error' ? <CircleX className="size-3 text-destructive" /> :
    <Wrench className="size-3" />;

  return (
    <span className="inline-flex max-w-full flex-col rounded-lg border border-border/70 bg-muted/50 text-[11px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-start"
        aria-expanded={open}
      >
        <span aria-hidden>{icon}</span>
        <span className="font-medium">{label}</span>
        {chip.summary && <span className="max-w-[220px] truncate text-muted-foreground" dir="auto">{chip.summary}</span>}
        {statusIcon}
      </button>
      {open && chip.args && (
        <pre dir="ltr" className="max-h-40 overflow-auto border-t border-border/60 bg-card px-2 py-1.5 font-mono text-[10px] leading-4 text-muted-foreground">
          {(() => {
            try {
              return JSON.stringify(JSON.parse(chip.args), null, 2);
            } catch {
              return chip.args;
            }
          })()}
        </pre>
      )}
    </span>
  );
}

/* ------------------------------- message item ------------------------------- */

interface Props {
  message: StoredMessage;
  siblingIds: string[];
  onSwitchBranch: (id: string) => void;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, newText: string) => void;
}

export const MessageItem = memo(function MessageItem({ message, siblingIds, onSwitchBranch, onRegenerate, onEdit }: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  const text = useMemo(() => partsText(message.parts), [message.parts]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('کپی ناموفق بود');
    }
  };

  const speak = () => {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text.slice(0, 800));
      utter.lang = 'fa-IR';
      window.speechSynthesis.speak(utter);
    } catch {
      toast.error('خواندن صوتی در این مرورگر پشتیبانی نمی‌شود.');
    }
  };

  const addToMemory = async () => {
    const db = await getDb();
    await db.memories.add({
      id: crypto.randomUUID(),
      text: text.slice(0, 400),
      source: 'manual',
      createdAt: Date.now(),
    });
    toast.success('به حافظه بلندمدت اضافه شد');
  };

  const branchIndex = siblingIds.indexOf(message.id);
  const hasSiblings = siblingIds.length > 1;
  const prevSibling = hasSiblings ? siblingIds[(branchIndex - 1 + siblingIds.length) % siblingIds.length] : null;
  const nextSibling = hasSiblings ? siblingIds[(branchIndex + 1) % siblingIds.length] : null;

  /* tool results message: render as compact result cards */
  if (isTool) {
    return (
      <div className="py-1 ps-10.5" data-testid="tool-results">
        <div className="flex flex-wrap gap-1.5">
          {message.parts.map((p) =>
            p.type === 'tool_result' ? (
              <span
                key={p.toolCallId}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]',
                  p.isError ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                )}
              >
                {p.isError ? '⛔' : '✓'} نتیجه {p.name.startsWith('mcp__')
                  ? TOOL_PERSIAN_NAMES[p.name.split('__').pop() as keyof typeof TOOL_PERSIAN_NAMES] ?? p.name.split('__').pop()
                  : TOOL_PERSIAN_NAMES[p.name as keyof typeof TOOL_PERSIAN_NAMES] ?? p.name}
              </span>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  return (
    <article
      className={cn('group flex items-start gap-2.5 py-2', isUser && 'flex-row-reverse')}
      data-role={message.role}
    >
      {/* avatar */}
      <div
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full text-sm shadow-sm',
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary font-bold text-primary-foreground',
        )}
        aria-hidden
      >
        {isUser ? 'شما' : 'هـ'}
      </div>

      <div className={cn('min-w-0 max-w-full flex-1', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'min-w-0 max-w-full rounded-2xl border px-4 py-3 shadow-sm',
            isUser ? 'rounded-se-md border-primary/20 bg-primary/10' : 'rounded-ss-md border-border/70 bg-card',
          )}
        >
          {/* tool calls inside assistant messages */}
          {message.parts.some((p) => p.type === 'tool_call') && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.parts.filter((p) => p.type === 'tool_call').map((p) => {
                const call = p as { type: 'tool_call'; id: string; name: string; args: string };
                return (
                  <ToolChipRow
                    key={call.id}
                    chip={{ id: call.id, name: call.name, args: call.args, status: 'ok', summary: '' }}
                  />
                );
              })}
            </div>
          )}

          {/* images */}
          {message.parts.some((p) => p.type === 'image') && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.parts.filter((p) => p.type === 'image').map((p, i) => {
                const img = p as { type: 'image'; mimeType: string; data: string; name?: string };
                return (
                  <img
                    key={i}
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt={img.name ?? 'تصویر پیوست'}
                    className="max-h-52 rounded-lg border border-border/60 object-cover"
                  />
                );
              })}
            </div>
          )}

          {editing ? (
            <div className="flex min-w-[260px] flex-col gap-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={4}
                className="text-sm"
                aria-label="ویرایش پیام"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>انصراف</Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    setEditing(false);
                    onEdit(message.id, editText);
                  }}
                >
                  ثبت و اجرای مجدد
                </Button>
              </div>
            </div>
          ) : (
            <Markdown content={text} />
          )}
        </div>

        {/* action bar */}
        <div className={cn('mt-1 flex items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100', isUser && 'flex-row-reverse')}>
          <span className="px-1 text-[10px]" dir="ltr">{faTime(message.createdAt)}</span>
          {message.ttftMs != null && <span className="px-1 text-[10px]" dir="ltr">TTFT {message.ttftMs}ms</span>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={copy} aria-label="کپی پیام">
                {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>کپی</TooltipContent>
          </Tooltip>
          {isUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="ویرایش و انشعاب"
                  onClick={() => {
                    setEditText(text);
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>ویرایش (شاخه جدید)</TooltipContent>
            </Tooltip>
          )}
          {!isUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => onRegenerate(message.id)} aria-label="پاسخ دوباره">
                  <RefreshCw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>تولید دوباره</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={speak} aria-label="خواندن صوتی">
                <Volume2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>پخش صوتی</TooltipContent>
          </Tooltip>
          {!isUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" onClick={addToMemory} aria-label="افزودن به حافظه">
                  <Brain className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>ذخیره در حافظه</TooltipContent>
            </Tooltip>
          )}

          {/* branch switcher */}
          {hasSiblings && (
            <span className="ms-1 inline-flex items-center gap-0.5 rounded-full border border-border/60 px-1 py-0.5 text-[10px]">
              <GitBranch className="size-3" aria-hidden />
              <button
                onClick={() => prevSibling && onSwitchBranch(prevSibling)}
                aria-label="شاخه قبلی"
                className="rounded p-0.5 hover:text-foreground"
              >
                <ChevronRight className="size-3" />
              </button>
              <span dir="ltr">{branchIndex + 1}/{siblingIds.length}</span>
              <button
                onClick={() => nextSibling && onSwitchBranch(nextSibling)}
                aria-label="شاخه بعدی"
                className="rounded p-0.5 hover:text-foreground"
              >
                <ChevronLeft className="size-3" />
              </button>
            </span>
          )}
        </div>
      </div>
    </article>
  );
});
