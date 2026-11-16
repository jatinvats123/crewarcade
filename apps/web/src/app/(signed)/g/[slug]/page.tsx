import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GamePage } from '@/components/game/GamePage';
import { fetchPublicGame, madeBy } from '@/lib/public-game';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const game = await fetchPublicGame(slug);
  if (!game) return { title: 'Game not found' };
  const published = game.publishedVersion !== null;
  const title = `${game.emoji} ${game.title}`;
  const description = published
    ? `${game.pitch} ${madeBy(game.crew.name)}. Tap to play.`
    : `${game.crew.name} is building this game with Pixel, Forge & Glitch.`;
  // The image comes from ./opengraph-image.tsx (Next adds og:image + twitter:image).
  return {
    title: game.title,
    description,
    alternates: { canonical: `/g/${game.slug}` },
    openGraph: { title, description, type: 'website', url: `/g/${game.slug}`, siteName: 'CrewArcade' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function PublicGamePage({ params }: Params) {
  const { slug } = await params;
  const game = await fetchPublicGame(slug);
  if (!game) notFound();
  return <GamePage game={game} />;
}
