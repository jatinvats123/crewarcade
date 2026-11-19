'use client';

// First run: three steps (pitch → approve → play) in a dialog with Skip. Opens once per browser
// (on the crews launch pad) and from "See how it works".
import { useState } from 'react';
import { Button, Sheet } from '@/components/ui';

export const HOWTO_KEY = 'crewarcade:howto-done';

/** True until the guide was finished or skipped on this browser (storage blocked: show it). */
export function howToPending(): boolean {
  try {
    return localStorage.getItem(HOWTO_KEY) !== '1';
  } catch {
    return true;
  }
}

const STEPS = [
  { n: '01', title: 'Pitch', text: 'Type your idea in the crew chat (or tap one of the ideas). Pixel turns it into a game plan with a checklist.' },
  { n: '02', title: 'Approve', text: 'Your crew votes, an approver taps Approve, and Forge builds the game live in the chat.' },
  { n: '03', title: 'Play', text: 'Glitch playtests it. Tap ▶ Play, beat each other’s scores, then tap Allow to put it in the Arcade.' },
] as const;

export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const done = () => {
    try {
      localStorage.setItem(HOWTO_KEY, '1');
    } catch {
      /* storage blocked: shows again next time */
    }
    setStep(0);
    onClose();
  };
  const s = STEPS[step]!;
  return (
    <Sheet
      open={open}
      onClose={done}
      title="How it works"
      footer={
        <div className="flex w-full items-center justify-between gap-2" data-testid="how-it-works">
          <Button size="sm" variant="ghost" onClick={done}>
            Skip
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={done}>
                Got it
              </Button>
            )}
          </div>
        </div>
      }
    >
      <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((x, i) => (
          <li key={x.title} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand' : 'bg-surface-3'}`} aria-hidden />
        ))}
      </ol>
      <div className="mt-6" aria-live="polite">
        <p className="font-poster text-2xl text-brand">{s.n}</p>
        <p className="mt-1 font-poster text-5xl leading-none uppercase">{s.title}</p>
        <p className="mt-4 text-dim">{s.text}</p>
      </div>
    </Sheet>
  );
}
