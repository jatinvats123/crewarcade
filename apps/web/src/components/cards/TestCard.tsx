'use client';

// Glitch's Test card: PASS/FAIL, checks passed/total, fps, one row per acceptance item, the GIF of
// the run, ▶ Play, and on a FAIL [Ask for fix] (any member; the server checks) or, once the
// automatic fixes ran out, [Try again]. Metadata `next` says what follows a FAIL.
import { parseCardMeta, type TestCardContent } from '@crewarcade/shared';
import { useState } from 'react';
import { Badge, Button, CardShell, CheckList, CheckMark, useToast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';

const NEXT_TEXT: Record<string, string> = {
  autofix: 'Forge is fixing it automatically',
  asked: 'A fix is on its way',
  ask_crew: 'Automatic fixes used up: your call',
  publish: 'Sent for approval',
};

export function TestCard({ m, test }: { m: ChatMessage; test: TestCardContent }) {
  const env = useCardEnv();
  const toast = useToast();
  const meta = parseCardMeta('test', m.meta);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const messageId = m.messageId ?? '';
  const fix = async () => {
    setBusy(true);
    try {
      await env.actions.askForFix(messageId);
      env.setMeta(m.channelId, messageId, { next: 'asked' });
      toast('Sent! Forge fixes the failed checks, then Glitch tests again.', 'success');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't ask for a fix.", 'danger');
    } finally {
      setBusy(false);
    }
  };
  const canFix = !test.pass && (meta.next === 'ask_crew' || meta.next === 'none');
  const items = showAll ? test.items : test.items.slice(0, 6);
  const extra = test.failures.filter(f => !/^A\d{1,2}\b/.test(f.label));
  const facts = [`${test.passed}/${test.total} checks`, `${Math.round(test.fps)} fps`, test.round > 0 ? `fix round ${test.round}` : null].filter(Boolean);

  return (
    <CardShell
      agent="glitch"
      tour="test-card"
      className="w-full"
      title={
        <>
          Playtest v{test.version}: <span className={test.pass ? 'text-success' : 'text-danger'}>{test.pass ? 'PASS' : 'FAIL'}</span>
        </>
      }
      meta={facts.join(' · ')}
      badges={
        <span className="inline-flex flex-wrap gap-1.5">
          <Badge tone={test.pass ? 'success' : 'danger'}>{test.pass ? 'PASS' : 'FAIL'}</Badge>
          {!test.pass && NEXT_TEXT[meta.next] && <Badge tone="gold">{NEXT_TEXT[meta.next]}</Badge>}
        </span>
      }
      actions={
        <>
          <Button size="sm" onClick={() => env.actions.play(test.gameId, test.version)} data-testid="test-play" data-tour="test-play">
            ▶ Play
          </Button>
          {canFix && (
            <Button variant="ghost" size="sm" loading={busy} onClick={() => void fix()} data-testid="test-fix" data-tour="test-fix">
              {meta.next === 'ask_crew' ? '↻ Try again' : '🛠 Ask for fix'}
            </Button>
          )}
        </>
      }
    >
      {test.gifUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- playtest GIF from our clips bucket
        <img src={test.gifUrl} alt={`Glitch playing v${test.version}`} className="w-full rounded-2xl border border-border bg-bg" loading="lazy" />
      )}
      {test.items.length > 0 && (
        <div className="mt-3" data-testid="test-items">
          <CheckList label={`Glitch's checks · ${test.passed}/${test.total}`}>
            {items.map(it => (
              <li key={it.id} className="flex gap-2.5">
                <CheckMark state={it.pass ? 'pass' : 'fail'} />
                <span>
                  <span className="text-faint">{it.id}</span> {it.text}
                  {!it.pass && it.detail && <span className="block font-sans text-sm text-dim">{it.detail}</span>}
                </span>
              </li>
            ))}
          </CheckList>
        </div>
      )}
      {test.items.length > 6 && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show less' : `Show all ${test.items.length}`}
        </Button>
      )}
      {test.regressions.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-dim" data-testid="test-warnings">
          {test.regressions.slice(0, 4).map((w, i) => (
            <li key={i}>
              ⚠ <span className="font-semibold">{w.label}</span>: {w.detail}
            </li>
          ))}
        </ul>
      )}
      {extra.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {extra.slice(0, 4).map((f, i) => (
            <li key={i}>
              ❌ <span className="font-semibold">{f.label}</span>: {f.detail}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}
