import type { Metadata } from 'next';
import { Gallery } from './Gallery';

export const metadata: Metadata = { title: 'UI kit', robots: { index: false } };

export default function DevUiPage() {
  return <Gallery />;
}
