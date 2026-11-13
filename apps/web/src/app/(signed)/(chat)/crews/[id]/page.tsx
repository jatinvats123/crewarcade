import type { Metadata } from 'next';
import { ChatView } from '@/components/chat/ChatView';

export const metadata: Metadata = { title: 'Chat' };

export default async function CrewChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView key={id} crewId={id} />;
}
