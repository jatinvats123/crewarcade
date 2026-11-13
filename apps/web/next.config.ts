import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Microphone: voice notes. Photos use the file picker (capture attribute), not getUserMedia, so camera stays off.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
];

// First-party API proxy: the browser only talks to this origin; /api/* is forwarded to the
// CrewArcade server (Render), so the session cookie is a first-party, host-only cookie on the web
// domain (no third-party cookies, no CORS). docs/SPEC.md "Sessions and the API proxy".
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@crewarcade/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
