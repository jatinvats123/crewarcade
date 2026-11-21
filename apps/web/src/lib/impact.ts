// Formatting for the public /impact page (pure, unit-tested).
import type { ImpactResponse } from '@crewarcade/shared';

type Step = ImpactResponse['funnel'][number]['step'];

/** What each step of the loop means, in the page's words. */
export const FUNNEL_TEXT: Record<Step, { label: string; what: string }> = {
  pitched: { label: 'Pitched', what: 'Pixel turned an idea into a plan card' },
  approved: { label: 'Approved', what: 'the crew said go' },
  built: { label: 'Built', what: 'Forge wrote a playable game' },
  passed: { label: 'Passed', what: "Glitch's playtest passed in a real browser" },
  published: { label: 'Published', what: 'an approver tapped Allow' },
  played: { label: 'Played', what: 'someone set a score' },
};

const REFERRERS: Record<string, string> = {
  college: 'College groups',
  school: 'School groups',
  family: 'Family groups',
  office: 'Office groups',
  insta: 'Instagram',
  discord: 'Discord',
  linkedin: 'LinkedIn',
  wa: 'WhatsApp',
  invite: 'Crew invites',
  direct: 'Direct visits',
  other: 'Other links',
};

export const referrerLabel = (code: string): string => REFERRERS[code] ?? code;

/** 71_000 → "71 s", 150_000 → "2.5 min", null → "–". */
export function duration(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < 90_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${(ms / 60_000).toFixed(1).replace(/\.0$/, '')} min`;
}

/** Share of `part` in `whole` as a whole percent (0 when whole is 0). */
export const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Bar width for a value against the largest value, with a visible sliver for any non-zero value. */
export const barWidth = (value: number, max: number): string => (max > 0 && value > 0 ? `${Math.max(4, Math.round((value / max) * 100))}%` : '0%');

/** "2026-11-21" → "Sat 21 Nov" (the date is already an IST day). */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(',', '');
}

/** An ISO time as "21 Nov, 6:42 pm IST". */
export function istTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()} IST`;
}

/** US dollars with an approximate rupee figure: 0.02 → "$0.02 (about ₹2)". */
export function usdWithRupees(usd: number | null, inrPerUsd = 88): string {
  if (usd === null) return '–';
  const inr = usd * inrPerUsd;
  return `$${usd < 0.1 ? usd.toFixed(3).replace(/0$/, '') : usd.toFixed(2)} (about ₹${inr < 10 ? inr.toFixed(1).replace(/\.0$/, '') : Math.round(inr)})`;
}
