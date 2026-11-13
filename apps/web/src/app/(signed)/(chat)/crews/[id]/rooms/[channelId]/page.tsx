import type { Metadata } from 'next';
import { ChatView } from '@/components/chat/ChatView';

export const metadata: Metadata = { title: 'Game room' };

export default async function GameRoomPage({ params }: { params: Promise<{ id: string; channelId: string }> }) {
  const { id, channelId } = await params;
  return <ChatView key={channelId} crewId={id} roomChannelId={channelId} />;
}
