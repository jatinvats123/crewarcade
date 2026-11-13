import type { Metadata } from 'next';
import { JoinView } from './JoinView';

export const metadata: Metadata = {
  title: 'Join a crew',
  description: 'You were invited to a CrewArcade crew: friends + 3 AI agents making games together.',
};

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinView code={code.toUpperCase()} />;
}
