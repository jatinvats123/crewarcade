import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui';

export const metadata: Metadata = { title: 'Crews' };

// Phones show the crew list (rendered by the shell) on this route; wider screens show the list in
// the left column and this prompt in the middle.
export default function CrewsIndex() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <EmptyState emoji="💬" title="Pick a crew">
        Choose a crew on the left, or make a new one. Pixel, Forge and Glitch are in every crew.
      </EmptyState>
    </div>
  );
}
