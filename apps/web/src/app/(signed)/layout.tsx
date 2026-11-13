import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';

// Everything that needs to know who is signed in (onboarding, invites, the chat). The landing page
// stays outside so it never calls the API.
export default function SignedLayout({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
