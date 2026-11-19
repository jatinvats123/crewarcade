import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { devPagesEnabled } from '@/env';

// Developer pages (UI kit, card demos) are 404 in production unless NEXT_PUBLIC_DEV_PAGES=1 (e2e).
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devPagesEnabled) notFound();
  return children;
}
