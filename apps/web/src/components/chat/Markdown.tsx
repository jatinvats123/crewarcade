// Renders the safe Markdown subset (lib/chat/markdown.ts) with React elements only.
import { Fragment, useMemo } from 'react';
import { parseMarkdown, type Inline } from '@/lib/chat/markdown';
import { cn } from '@/lib/cn';

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>;
          case 'strong':
            return (
              <strong key={i} className="font-semibold">
                <Inlines nodes={n.c} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case 'code':
            return (
              <code key={i} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">
                {n.v}
              </code>
            );
          case 'link':
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-glitch underline underline-offset-2">
                {n.v}
              </a>
            );
        }
      })}
    </>
  );
}

/** `caret`: a soft blinking caret after the last block while a stream is still arriving. */
export function Markdown({ text, caret, className }: { text: string; caret?: boolean; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const caretEl = caret ? (
    <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[0.45em] translate-y-[0.15em] animate-pulse rounded-sm bg-current opacity-60" />
  ) : null;
  return (
    <div className={cn('flex flex-col gap-1.5 break-words', className)}>
      {blocks.length === 0 && caretEl}
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        switch (b.t) {
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Inlines nodes={l} />
                  </Fragment>
                ))}
                {last && caretEl}
              </p>
            );
          case 'h':
            return (
              <p key={i} className="font-display font-bold">
                <Inlines nodes={b.c} />
                {last && caretEl}
              </p>
            );
          case 'ul':
          case 'ol': {
            const List = b.t;
            return (
              <List key={i} className={cn('flex flex-col gap-0.5 pl-5', b.t === 'ul' ? 'list-disc' : 'list-decimal')}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines nodes={it} />
                    {last && j === b.items.length - 1 && caretEl}
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
