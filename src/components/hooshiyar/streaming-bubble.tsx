'use client';

/**
 * StreamingBubble — live assistant turn: streaming text + tool chips + step label.
 */
import { useAppStore } from '@/components/hooshiyar/store';
import { Markdown } from '@/components/hooshiyar/markdown';
import { ToolChipRow } from '@/components/hooshiyar/message-item';

export function StreamingBubble() {
  const streamText = useAppStore((s) => s.streamText);
  const toolChips = useAppStore((s) => s.toolChips);
  const stepLabel = useAppStore((s) => s.stepLabel);

  return (
    <div className="flex items-start gap-2.5 py-2" data-testid="streaming-bubble">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-sm" aria-hidden>
        هـ
      </div>
      <div className="min-w-0 flex-1">
        {stepLabel && (
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
            <span className="hsh-dot" aria-hidden />
            {stepLabel}
          </div>
        )}
        <div className="rounded-2xl rounded-ss-md border border-border/70 bg-card px-4 py-3 shadow-sm">
          {toolChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {toolChips.map((c) => (
                <ToolChipRow key={c.id} chip={c} />
              ))}
            </div>
          )}
          {streamText ? (
            <>
              <Markdown content={streamText} />
              <span className="hsh-caret" aria-hidden />
            </>
          ) : (
            <div className="flex items-center gap-1 py-1" aria-label="در حال دریافت پاسخ">
              <span className="hsh-dot" aria-hidden />
              <span className="hsh-dot" aria-hidden />
              <span className="hsh-dot" aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
