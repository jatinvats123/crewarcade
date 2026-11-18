// Server-side fetch of the public Arcade (published games). Runs on the web server, no cookies.
import { ArcadeResponse, type ArcadeQuery } from '@crewarcade/shared';
import { publicEnv } from '@/env';

export async function fetchArcade(sort: ArcadeQuery['sort']): Promise<ArcadeResponse | null> {
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_ORIGIN.replace(/\/+$/, '')}/api/public/arcade?sort=${sort}&limit=24`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const parsed = ArcadeResponse.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 1234 → "1.2k" */
export const compact = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`);
