'use client';

// Forge's Build card. Posted when a build starts; its metadata (rewritten by the server on every
// step) streams the progress lines live, then flips to Ready (▶ Play, Change) or Failed (problems,
// Try again). Re-renders on every metadata update.
import { parseCardMeta, type BuildCardContent, type BuildStep } from '@crewarcade/shared';
import { useState } from 'react';
import { Badge, Button, CardShell, Sheet, useToast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';

const REASON: Record<BuildCardContent['reason'], string> = { build: '', change: 'Change', remix: 'Remix', retry: 'Retry' };

function StepIcon({ s }: { s: BuildStep['s'] }) {
  if (s === 'done')
    return (
      <span className="text-success" aria-label="done">
        ✓
      </span>
    );
  if (s === 'failed')
    return (
      <span className="text-danger" aria-label="failed">
        ✕
      </span>
    );
  if (s === 'doing')
    return <span className="inline-block size-3 animate-spin rounded-full border-2 border-forge border-t-transparent" aria-label="in progress" />;
  return <span className="inline-block size-2 rounded-full bg-faint/60" aria-label="to do" />;
}

export function BuildCard({ m, build }: { m: ChatMessage; build: BuildCardContent }) {
  const env = useCardEnv();
  const toast = useToast();
  const meta = parseCardMeta('build', m.meta);
  const [busy, setBusy] = useState<'retry' | 'change' | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeText, setChangeText] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const messageId = m.messageId ?? '';
  const steps = meta.steps.length > 0 ? meta.steps : [{ t: 'Reading the plan', s: 'doing' as const }];

  const retry = async () => {
    setBusy('retry');
    try {
      await env.actions.retryBuild(messageId);
      toast(`Forge will try v${build.version} again.`, 'success');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't ask for a retry.", 'danger');
    } finally {
      setBusy(null);
    }
  };
  const sendChange = async () => {
    setBusy('change');
    try {
      await env.actions.requestChange(messageId, changeText.trim());
      setChangeOpen(false);
      setChangeText('');
      toast('Sent! Pixel writes the change, then Forge builds the next version.', 'success');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't send the change.", 'danger');
    } finally {
      setBusy(null);
    }
  };

  const facts = [
    meta.sizeKb !== undefined && `${meta.sizeKb.toFixed(1)} KB`,
    meta.buildMs !== undefined && `${Math.max(1, Math.round(meta.buildMs / 1000))} s`,
    meta.attempts !== undefined && meta.attempts > 1 && `${meta.attempts} tries`,
  ].filter(Boolean);

  return (
    <>
      <CardShell
        agent="forge"
        className="w-full"
        title={`🔨 ${build.title} · v${build.version}`}
        meta={facts.length > 0 ? facts.join(' · ') : REASON[build.reason] ? `${REASON[build.reason]} build` : 'Building from the approved plan'}
        badges={
          <Badge tone={meta.status === 'ready' ? 'success' : meta.status === 'failed' ? 'danger' : 'forge'}>
            {meta.status === 'ready' ? 'Ready' : meta.status === 'failed' ? 'Failed' : 'Building'}
          </Badge>
        }
        actions={
          meta.status === 'ready' ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => env.actions.play(build.gameId, build.version, build.title)} data-testid="build-play">
                ▶ Play
              </Button>
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setChangeOpen(true)}>
                ✏️ Change
              </Button>
            </div>
          ) : meta.status === 'failed' ? (
            <Button size="sm" loading={busy === 'retry'} onClick={() => void retry()}>
              ↻ Try again
            </Button>
          ) : undefined
        }
      >
        {build.change && <p className="mb-2 text-sm text-dim">Change: {build.change}</p>}
        <ol className="flex flex-col gap-1" aria-label="Build progress" aria-live="polite">
          {steps.map((s, i) => (
            <li
              key={`${i}-${s.t}`}
              className={cn('flex items-center gap-2 text-sm', s.s === 'todo' ? 'text-faint' : s.s === 'failed' ? 'text-danger' : 'text-text')}
            >
              <span className="flex w-4 justify-center">
                <StepIcon s={s.s} />
              </span>
              {s.t}
            </li>
          ))}
        </ol>
        {meta.status === 'ready' && meta.notes.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-dim">
            {meta.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {meta.status === 'failed' && (
          <div className="mt-2 text-sm">
            {meta.error && <p className="text-dim">{meta.error}</p>}
            {meta.problems.length > 0 && (
              <>
                <button
                  type="button"
                  className="mt-1 min-h-11 text-sm font-semibold text-brand"
                  onClick={() => setShowProblems(v => !v)}
                  aria-expanded={showProblems}
                >
                  {showProblems ? 'Hide' : 'Show'} the {meta.problems.length} problem{meta.problems.length === 1 ? '' : 's'}
                </button>
                {showProblems && (
                  <ol className="list-decimal pl-5 text-xs text-dim">
                    {meta.problems.map((p, i) => (
                      <li key={i} className="break-words">
                        {p}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
        )}
      </CardShell>
      <Sheet
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={`Change ${build.title}`}
        footer={
          <Button block loading={busy === 'change'} disabled={changeText.trim().length < 3} onClick={() => void sendChange()}>
            Ask for v{build.version + 1}
          </Button>
        }
      >
        <label htmlFor={`build-change-${messageId}`} className="text-sm text-dim">
          What should change? Pixel writes it down, Forge builds the next version. v{build.version} stays playable.
        </label>
        <textarea
          id={`build-change-${messageId}`}
          value={changeText}
          onChange={e => setChangeText(e.target.value.slice(0, 280))}
          rows={3}
          placeholder="Make it faster, bigger potholes, more stars…"
          className="mt-2 w-full rounded-2xl border border-border bg-surface-2 p-3 text-base outline-none focus:border-brand"
        />
        <p className="text-right text-xs text-faint">{changeText.length}/280</p>
      </Sheet>
    </>
  );
}
