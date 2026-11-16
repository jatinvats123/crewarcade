import type { Metadata } from 'next';
import { GlitchThread } from '@/components/dm/GlitchThread';

export const metadata: Metadata = { title: 'Glitch' };

export default function GlitchPage() {
  return <GlitchThread />;
}
