'use client';

/**
 * ApprovalDialog — human-in-the-loop gate for dangerous tool calls
 * (shell commands). Rendered from the store's approval request promise.
 */
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/components/hooshiyar/store';
import { TOOL_PERSIAN_NAMES } from '@/lib/agent/tools';

export function ApprovalDialog() {
  const approval = useAppStore((s) => s.approval);
  const open = approval !== null;

  const decide = (ok: boolean) => {
    approval?.resolve(ok);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && decide(false)}>
      <DialogContent className="sm:max-w-md" dir="rtl" aria-describedby="approval-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-5 text-amber-500" aria-hidden />
            تأیید اقدام حساس
          </DialogTitle>
          <DialogDescription id="approval-desc" className="text-xs">
            عامل می‌خواهد «{approval ? TOOL_PERSIAN_NAMES[approval.toolName as keyof typeof TOOL_PERSIAN_NAMES] ?? approval.toolName : ''}» اجرا کند. قبل از تأیید، فرمان را بررسی کنید.
          </DialogDescription>
        </DialogHeader>

        {approval && (
          <div className="rounded-xl border border-amber-600/30 bg-amber-500/5 p-3">
            <p className="mb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">{approval.detail}</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-card p-2.5 font-mono text-xs leading-5" dir="ltr">
              {approval.summary}
            </pre>
          </div>
        )}

        <DialogFooter className="flex-row justify-start gap-2">
          <Button variant="destructive" size="sm" onClick={() => decide(false)}>
            رد کردن
          </Button>
          <Button size="sm" onClick={() => decide(true)}>
            تأیید و اجرا
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
