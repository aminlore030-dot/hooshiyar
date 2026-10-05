'use client';

/**
 * Markdown renderer — GFM + code highlighting + copy buttons.
 * Persian text uses dir=rtl; code blocks stay LTR.
 */
import { memo, useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied */
    }
  }, [code]);

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border border-border/70 bg-muted/40" dir="ltr">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{lang || 'code'}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={copy}
          aria-label="کپی کد"
        >
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          {copied ? 'کپی شد' : 'کپی'}
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className={`hljs language-${lang ?? 'plaintext'}`}>{code}</code>
      </pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="md-content text-[15px] leading-8">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: (props: any) => {
            const { node, className, children, ...rest } = props;
            const isBlock = node?.position && String(children).includes('\n');
            const match = /language-(\w+)/.exec(className || '');
            const raw = String(children).replace(/\n$/, '');
            if (isBlock || match || (node?.tagName === 'code' && String(children).length > 80)) {
              return <CodeBlock code={raw} lang={match?.[1]} />;
            }
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-emerald-700 dark:text-emerald-400" dir="ltr" {...rest}>
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 underline decoration-emerald-600/40 underline-offset-4 hover:decoration-emerald-600 dark:text-emerald-400"
              dir="auto"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border/70 bg-muted/50 px-3 py-2 text-start font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/50 px-3 py-2">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-e-4 border-emerald-600/50 bg-emerald-500/5 px-4 py-1 text-muted-foreground">
              {children}
            </blockquote>
          ),
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pe-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pe-5">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 font-bold">{children}</h3>,
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
          hr: () => <hr className="my-4 border-border/60" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
