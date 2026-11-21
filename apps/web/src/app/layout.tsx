import type { Metadata, Viewport } from 'next';
import { Anton, Inter, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { RefCapture } from '@/components/shell/RefCapture';
import { WakeBanner } from '@/components/shell/WakeBanner';
import { JudgeTour } from '@/components/tour/JudgeTour';
import { ToastProvider } from '@/components/ui';
import { publicEnv } from '@/env';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', weight: ['500', '700'] });
const poster = Anton({ subsets: ['latin'], variable: '--font-anton', display: 'swap', weight: '400' });
const body = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { default: 'CrewArcade', template: '%s · CrewArcade' },
  description: 'Your friends + 3 AI agents. One chat. A new game in minutes.',
  applicationName: 'CrewArcade',
  openGraph: { title: 'CrewArcade', description: 'Your friends + 3 AI agents. One chat. A new game in minutes.', type: 'website' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Android Chrome: the on-screen keyboard resizes the layout, so the composer stays above it.
  interactiveWidget: 'resizes-content',
  themeColor: '#0a0a0a',
};

// Applies a saved theme choice before paint (no flash). Dark is the default; light only when chosen.
const themeScript = `try{var t=localStorage.getItem('crewarcade:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${poster.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <ToastProvider>
          <WakeBanner />
          <RefCapture />
          {children}
          <JudgeTour />
        </ToastProvider>
      </body>
    </html>
  );
}
