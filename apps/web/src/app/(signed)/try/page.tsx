import type { Metadata } from 'next';
import { JudgeMode } from './JudgeMode';

// Judge mode: one tap, no sign-up form. A judge account (never counted on /impact), a solo crew with
// Pixel, Forge and Glitch, and a pitch already typed in the chat.
export const metadata: Metadata = {
  title: 'Judge mode',
  description: 'Try CrewArcade in 3 minutes: one tap, no sign-up. Pitch a game, approve the plan, watch it get built and playtested.',
  alternates: { canonical: '/try' },
};

export default function TryPage() {
  return <JudgeMode />;
}
