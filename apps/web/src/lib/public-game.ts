// Server-side fetch of a public game page (used by /g/[slug] and its Open Graph image). Runs on the
// web server (Vercel), straight to the CrewArcade server; no cookies, public data only.
import { GamePageResponse } from '@crewarcade/shared';
import { publicEnv } from '@/env';

export async function fetchPublicGame(slug: string): Promise<GamePageResponse | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) return null;
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_ORIGIN.replace(/\/+$/, '')}/api/public/games/${slug}`, { next: { revalidate: 30 } });
    if (!res.ok) return null;
    const parsed = GamePageResponse.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** "Made by Chai Crew with Pixel, Forge & Glitch" */
export const madeBy = (crew: string) => `Made by ${crew} with Pixel, Forge & Glitch`;

/** Devanagari through Sinhala (U+0900-U+0DFF): scripts that need complex text shaping. */
export const needsShaping = (s: string): boolean => /[ऀ-෿]/.test(s);

/**
 * The headline and line drawn on the Open Graph card. next/og (satori) cannot shape Indic scripts
 * (vowel signs and conjuncts land in the wrong place), so such a title or crew name is never drawn:
 * the card says "<crew>'s new game" instead, and the preview's text line (og:title) shows the title.
 */
export function ogCardText(game: Pick<GamePageResponse, 'title' | 'publishedVersion' | 'crew'> | null): { title: string; line: string } {
  if (!game) return { title: 'CrewArcade', line: 'Your friends + 3 AI agents. One chat. A new game in minutes.' };
  const crew = needsShaping(game.crew.name) ? null : game.crew.name;
  const title = !needsShaping(game.title) ? game.title : crew ? `${crew}'s new game` : 'A new CrewArcade game';
  const line = game.publishedVersion !== null ? (crew ? madeBy(crew) : 'Made with Pixel, Forge & Glitch') : `${crew ?? 'A crew'} is building this right now`;
  return { title, line };
}
