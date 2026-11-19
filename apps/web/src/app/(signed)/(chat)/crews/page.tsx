import type { Metadata } from 'next';
import { LaunchPad } from '@/components/crews/LaunchPad';

export const metadata: Metadata = { title: 'Crews' };

// Phones show the crew list (rendered by the shell) on this route; wider screens show the list in
// the left column and the launch pad in the middle.
export default function CrewsIndex() {
  return <LaunchPad />;
}
