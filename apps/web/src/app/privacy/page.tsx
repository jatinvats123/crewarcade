import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What CrewArcade stores, for how long, and how to delete your account.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="pt-safe mx-auto flex max-w-2xl items-center px-4 py-3">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
      </header>
      <main className="pb-safe mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-12">
        <div>
          <h1 className="font-poster text-4xl tracking-wide uppercase">Privacy</h1>
          <p className="mt-1 text-dim">Short version: guest accounts, no email or password, the least data we need to run the game chat.</p>
        </div>

        <Section title="What we store">
          <ul className="list-disc space-y-1 pl-5">
            <li>Your guest profile: display name, emoji, colour and language. No email, phone number or password.</li>
            <li>Your crews and roles, the games your crews make (plans, code, versions) and their history (who approved what).</li>
            <li>Scores you set and bug reports you send, including any screenshot you attach (only your crew can see it).</li>
            <li>A copy of chat messages, so the agents can read the conversation: kept for 30 days, then deleted.</li>
            <li>Which link brought you here (for example &ldquo;invite&rdquo;), counted only as a total.</li>
          </ul>
        </Section>

        <Section title="Who else handles it">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Nexconn</strong> runs the group chat and keeps the chat history.
            </li>
            <li>
              <strong>An AI model provider</strong> receives pitches, chat messages that mention an agent and bug reports, to write plans, games and replies.
            </li>
            <li>
              <strong>Sarvam AI</strong> turns voice pitches into text (only when you send a voice note).
            </li>
            <li>
              <strong>Supabase</strong> (database and files), <strong>Render</strong> (server) and <strong>Vercel</strong> (website) host the app.
            </li>
          </ul>
          <p>We don&apos;t sell data and we don&apos;t run ads or third-party trackers.</p>
        </Section>

        <Section title="In your browser">
          <p>
            One sign-in cookie keeps you signed in on this browser (90 days). Your theme and the link you arrived from are kept in local storage. Games run in a
            sandbox and can&apos;t read either.
          </p>
        </Section>

        <Section title="Published games">
          <p>
            A game goes public only after a crew approver taps Allow. Public game pages show the game, its leaderboard (display names and scores) and the
            crew&apos;s display names.
          </p>
        </Section>

        <Section title="Delete your account">
          <p>
            Settings → Privacy → <strong>Delete my account</strong>. Your profile, scores, sign-in and chat logs are deleted at once and you are removed from
            your chats. Crews you own pass to another member; a crew with only you in it is deleted with its games. Games you helped make in other crews stay,
            credited to &ldquo;Deleted player&rdquo;. Messages already sent stay in the crew&apos;s chat history.
          </p>
        </Section>

        <p className="text-sm text-dim">
          Ages 13 and up. Questions: ask in the app&apos;s chat or contact the CrewArcade team through the page you found us on.{' '}
          <Link href="/" className="font-semibold text-brand underline">
            Back to CrewArcade
          </Link>
        </p>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 text-[0.95rem] leading-relaxed">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
