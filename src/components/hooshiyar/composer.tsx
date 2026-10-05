'use client';

/**
 * Composer — message input: autoresize textarea, attachments (images inline,
 * text/PDF → RAG), voice input (Web Speech API), send/stop, keyboard shortcuts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Mic, Square, X, Loader2, BookPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppStore } from '@/components/hooshiyar/store';
import { useChatSession } from '@/components/hooshiyar/use-chat-session';
import { addDocument } from '@/lib/rag';
import { formatBytes } from '@/lib/persian';
import type { ChatRec } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Attachment {
  kind: 'image';
  mimeType: string;
  data: string; // base64
  name: string;
}

export function Composer({ chat }: { chat: ChatRec }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const { sendMessage, stop } = useChatSession();
  const isStreaming = useAppStore((s) => s.isStreaming);

  /* autosize */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);

  /* keyboard: Enter = send, Shift+Enter = newline */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSend = useCallback(async () => {
    if (isStreaming) return;
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;
    setText('');
    const atts = attachments;
    setAttachments([]);
    await sendMessage(chat.id, trimmed, atts);
  }, [attachments, chat.id, isStreaming, sendMessage, text]);

  /* stop generation */
  const handleStop = () => {
    stop();
    abortRef.current?.abort();
  };

  /* attachments */
  const onPickFiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.pdf,.txt,.md,.markdown,.json,.csv,.tsv,.js,.ts,.py,.html,.css,.xml,.yaml,.yml,.log';
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`«${file.name}» بزرگ‌تر از ۱۵ مگابایت است.`);
          continue;
        }
        if (file.type.startsWith('image/')) {
          const buf = await file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          setAttachments((prev) => [...prev, { kind: 'image', mimeType: file.type, data: base64, name: file.name }]);
          continue;
        }
        // text/pdf → upload + RAG ingest + inline context
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: fd });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'خطای سرور');
          await addDocument(file.name, json.text, json.mime ?? file.type, file.size);
          toast.success(`«${file.name}» به اسناد اضافه شد (${formatBytes(json.chars)})`);
        } catch (e: any) {
          toast.error(`پردازش «${file.name}» ناموفق بود: ${e?.message ?? e}`);
        } finally {
          setUploading(false);
        }
      }
    };
    input.click();
  };

  /* voice input via Web Speech API */
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error('ورودی صوتی در این مرورگر پشتیبانی نمی‌شود (کروم را امتحان کنید).');
      return;
    }
    const rec = new SR();
    rec.lang = useAppStore.getState().settings.voiceLocale || 'fa-IR';
    rec.interimResults = true;
    rec.continuous = false;
    const base = text ? text + ' ' : '';
    rec.onresult = (e: any) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setText(base + transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      toast.error('تشخیص گفتار ناموفق بود.');
    };
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  return (
    <div className="border-t border-border/70 bg-card/50 p-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {/* attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="group relative">
                <img
                  src={`data:${a.mimeType};base64,${a.data}`}
                  alt={a.name}
                  className="size-16 rounded-lg border border-border/60 object-cover"
                />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-destructive text-white shadow"
                  aria-label={`حذف پیوست ${a.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded-2xl border border-border/80 bg-card p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={onPickFiles} disabled={uploading} aria-label="پیوست فایل">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>پیوست تصویر یا سند (PDF/متن → بازیابی)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-9 shrink-0', listening && 'text-destructive')}
                onClick={toggleVoice}
                aria-label={listening ? 'توقف ضبط صدا' : 'ورودی صوتی'}
                aria-pressed={listening}
              >
                <Mic className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>ورودی صوتی (فارسی)</TooltipContent>
          </Tooltip>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="پیام خود را بنویسید… (Enter برای ارسال، Shift+Enter خط جدید)"
            aria-label="متن پیام"
            className="max-h-[200px] min-h-[38px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />

          {isStreaming ? (
            <Button size="icon" className="size-9 shrink-0 rounded-xl bg-destructive hover:bg-destructive/90" onClick={handleStop} aria-label="توقف تولید پاسخ">
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-9 shrink-0 rounded-xl"
              onClick={handleSend}
              disabled={!text.trim() && !attachments.length}
              aria-label="ارسال پیام"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>

        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          کلیدهای شما فقط در مرورگر شما ذخیره می‌شوند · مدل‌ها ممکن است اشتباه کنند؛ اطلاعات مهم را راستی‌آزمایی کنید
        </p>
      </div>
    </div>
  );
}
