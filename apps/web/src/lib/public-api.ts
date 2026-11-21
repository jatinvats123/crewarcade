// Server-side fetches of public, no-login endpoints (no cookies; cached briefly by Next).
import { ImpactResponse, SafetyResponse } from '@crewarcade/shared';
import type { z } from 'zod';
import { publicEnv } from '@/env';

async function getPublic<T>(path: string, schema: z.ZodType<T>, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_ORIGIN.replace(/\/+$/, '')}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const fetchSafety = () => getPublic('/api/public/safety', SafetyResponse, 30);
export const fetchImpact = () => getPublic('/api/public/impact', ImpactResponse, 60);
/** The raw JSON behind /impact, linked from the page so anyone can check the numbers. */
export const impactJsonUrl = () => `${publicEnv.NEXT_PUBLIC_API_ORIGIN.replace(/\/+$/, '')}/api/public/impact`;
