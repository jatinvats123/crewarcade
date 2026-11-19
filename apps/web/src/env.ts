// Public (browser) environment. ONLY NEXT_PUBLIC_* values live here, and none of them is a
// secret: the Nexconn App Key is public by design (the Web SDK needs it); the App Secret, Supabase
// service key and AI keys exist only on the server. CI fails if a secret name shows up in web code
// (scripts/check-client-secrets.mjs).
import { z } from 'zod';

export const PublicEnvSchema = z.object({
  /** CrewArcade server origin (Render), e.g. https://crewarcade-server.onrender.com */
  NEXT_PUBLIC_API_ORIGIN: z.string().url().default('http://localhost:8080'),
  /** This site's origin, for share links and metadata. */
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  /** Nexconn App Key (public; used by NCEngine.initialize). Empty until the console app exists. */
  NEXT_PUBLIC_NEXCONN_APP_KEY: z.string().max(64).default(''),
  /** '1' turns on the developer pages (/dev/*: UI kit, card demos) in a production build (e2e only). */
  NEXT_PUBLIC_DEV_PAGES: z.enum(['0', '1']).default('0'),
});
export type PublicEnv = z.infer<typeof PublicEnvSchema>;

export function parsePublicEnv(env: Record<string, string | undefined>): PublicEnv {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const res = PublicEnvSchema.safeParse(clean);
  if (!res.success) throw new Error(`Invalid public env: ${res.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return res.data;
}

// Next.js inlines NEXT_PUBLIC_* only when referenced literally, so list them one by one.
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_NEXCONN_APP_KEY: process.env.NEXT_PUBLIC_NEXCONN_APP_KEY,
  NEXT_PUBLIC_DEV_PAGES: process.env.NEXT_PUBLIC_DEV_PAGES,
});

/** Developer pages: always in `next dev`, in production builds only with NEXT_PUBLIC_DEV_PAGES=1. */
export const devPagesEnabled = process.env.NODE_ENV !== 'production' || publicEnv.NEXT_PUBLIC_DEV_PAGES === '1';
