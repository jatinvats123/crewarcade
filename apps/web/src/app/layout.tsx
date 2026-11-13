import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { publicEnv } from '@/env';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', weight: ['500', '700'] });
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
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0a16' },
    { media: '(prefers-color-scheme: light)', color: '#faf8ff' },
  ],
};

// Applies a saved theme choice before paint (no flash). Default follows the OS (dark-first tokens).
const themeScript = `try{var t=localStorage.getItem('crewarcade:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
