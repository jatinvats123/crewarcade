'use client';

// The top of a new crew's chat (no games yet), instead of a black void: the crew's name as a poster,
// an invite card (copy the link, share on WhatsApp) and three pitch ideas that fill the composer.
// Scrolls away like normal history once the crew gets going.
import { GameScene } from '@/components/arcade/GameScene';
import { inviteText } from '@/lib/share';

const IDEAS: Array<{ text: string; emoji: string; colors: [string, string] }> = [
  { text: 'a mango dodging crows on a rooftop', emoji: '🥭', colors: ['#ffb547', '#2ec4b6'] },
  { text: 'a kite avoiding birds', emoji: '🪁', colors: ['#7c5cff', '#22d3ee'] },
  { text: 'a penguin delivering pizza', emoji: '🐧', colors: ['#38bdf8', '#f472b6'] },
];

export function CrewWelcome({
  crewName,
  inviteUrl,
  onCopy,
  onPitch,
}: {
  crewName: string;
  inviteUrl: string;
  onCopy: () => void;
  /** Puts "@pixel <idea>" in the composer (the user still taps Send). */
  onPitch: (idea: string) => void;
}) {
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(inviteText(crewName, inviteUrl))}`;
  return (
    <section aria-label={`Welcome to ${crewName}`} className="flex flex-col gap-6 pt-4 pb-6">
      <div>
        <p className="text-xs font-semibold tracking-[0.25em] text-brand uppercase">New crew</p>
        <p className="mt-2 font-poster text-[clamp(3rem,6vw,5.5rem)] leading-[0.9] break-words uppercase">{crewName}</p>
        <p className="mt-3 text-text/80">You, Pixel, Forge and Glitch. Games are more fun with friends: bring yours.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-[22px] border border-text/20 bg-text/5 p-5 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0 flex-1">
          <p className="font-poster text-2xl tracking-wide uppercase">Invite your friends</p>
          <p className="mt-1 text-sm text-dim">Anyone with the link joins this crew, agents included.</p>
          <p className="mt-3 truncate rounded-xl border border-text/15 bg-black/30 px-3.5 py-2.5 font-mono text-sm">{inviteUrl.replace(/^https?:\/\//, '')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-bold text-brand-ink hover:brightness-110"
          >
            Copy link
          </button>
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#25d366] px-4 text-sm font-bold text-[#052e12] hover:brightness-110"
          >
            Share on WhatsApp
          </a>
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-dim uppercase">Pitch your first game</p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {IDEAS.map(idea => (
            <li key={idea.text}>
              <button
                type="button"
                onClick={() => onPitch(idea.text)}
                className="group block w-full overflow-hidden rounded-[20px] border border-text/20 bg-text/5 text-left transition-colors hover:border-brand"
              >
                <span aria-hidden className="relative block h-20">
                  <GameScene seed={idea.text} emoji={idea.emoji} colors={idea.colors} hud={false} motion="hover" className="absolute inset-0" />
                </span>
                <span className="block px-4 py-3">
                  <span className="block text-sm">{idea.text}</span>
                  <span className="mt-1.5 block text-xs font-bold tracking-[0.14em] text-brand uppercase">Pitch it →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
