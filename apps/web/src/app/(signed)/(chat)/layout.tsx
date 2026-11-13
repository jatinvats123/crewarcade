import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
