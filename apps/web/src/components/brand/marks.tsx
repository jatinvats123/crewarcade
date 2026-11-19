/**
 * The CrewArcade mark family. One main icon (the D-pad "+3") and five signature marks, each with one
 * idea, used where that idea lives. All flat: brand colour + text colour on the page background, so
 * they follow the theme (lime site-wide, red on game pages). Decorative: always aria-hidden.
 *
 * - DpadMark      the main icon: a D-pad is a plus sign; three dots make it "+3" (your friends + 3 agents)
 * - PlayA         the A of ARCADE as a play triangle (used inside the wordmark)
 * - ChatPlayMark  a chat bubble with a play button cut out: you chat, a game comes out
 * - CursorsMark   four cursors meeting: made together, live (you in white, the agents in brand)
 * - JoystickMark  a CA monogram whose A carries a joystick ball
 * - CoinMark      an arcade coin slot with a coin going in: insert your crew
 */

type MarkProps = { className?: string };

export function DpadMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 36 32" className={className} aria-hidden>
      <rect x="9" y="2" width="10" height="28" rx="2.5" fill="var(--brand)" />
      <rect x="0" y="11" width="28" height="10" rx="2.5" fill="var(--brand)" />
      <circle cx="14" cy="16" r="2.4" fill="var(--bg)" />
      <rect x="31" y="2" width="4" height="4" fill="var(--text)" />
      <rect x="31" y="8" width="4" height="4" fill="var(--text)" />
      <rect x="31" y="14" width="4" height="4" fill="var(--text)" />
    </svg>
  );
}

/** A solid triangle as tall as Anton's capitals; sits on the baseline inside the wordmark. */
export function PlayA({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 20 22" className={className} aria-hidden>
      <path d="M0 22 L10 0 L20 22 Z" fill="var(--brand)" />
    </svg>
  );
}

export function ChatPlayMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="2" y="3" width="28" height="20" rx="6" fill="var(--brand)" />
      <path d="M7 21 L5 29 L14 21 Z" fill="var(--brand)" />
      <path d="M13 8 L13 18 L21.5 13 Z" fill="var(--bg)" />
    </svg>
  );
}

const ARROW = 'M0 0 L0 9 L2.6 6.6 L4.2 10.4 L5.8 9.6 L4.2 5.8 L7.6 5.8 Z';

export function CursorsMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      {[0, 90, 180, 270].map((deg, i) => (
        <g key={deg} transform={`rotate(${deg} 16 16)`}>
          <path d={ARROW} transform="translate(17.5 17.5) scale(1.25)" fill={i === 0 ? 'var(--text)' : 'var(--brand)'} />
        </g>
      ))}
    </svg>
  );
}

export function JoystickMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 40 32" className={className} aria-hidden>
      <path d="M15 6.5 A 9.5 9.5 0 1 0 15 25.5" fill="none" stroke="var(--brand)" strokeWidth="4.5" />
      <path d="M19 28 L27 10 L35 28" fill="none" stroke="var(--brand)" strokeWidth="4.5" strokeLinejoin="miter" />
      <circle cx="27" cy="5.5" r="3.8" fill="var(--text)" />
    </svg>
  );
}

export function CoinMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="6.25" y="9.25" width="19.5" height="21.5" rx="4" fill="none" stroke="var(--brand)" strokeWidth="2.5" />
      <rect x="14.75" y="14" width="2.5" height="10" rx="1.25" fill="var(--brand)" />
      <rect x="14.5" y="1" width="3" height="10" rx="1.5" fill="var(--text)" />
    </svg>
  );
}
