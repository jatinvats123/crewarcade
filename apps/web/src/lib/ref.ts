// Referrer codes (`?ref=` on invite and share links). First touch wins: the code a visitor first
// arrives with is kept in localStorage and sent once at sign-up (counted in /admin). No cookies.
import { RefCode } from '@crewarcade/shared';

const KEY = 'crewarcade:ref';

export function captureRef(search: string): void {
  try {
    const parsed = RefCode.safeParse(new URLSearchParams(search).get('ref') ?? '');
    if (parsed.success && !localStorage.getItem(KEY)) localStorage.setItem(KEY, parsed.data);
  } catch {
    /* storage blocked: no referrer */
  }
}

/** The stored code, else "invite" when signing up from an invite link. */
export function signupRef(fromInvite: boolean): string | undefined {
  try {
    const stored = RefCode.safeParse(localStorage.getItem(KEY) ?? '');
    if (stored.success) return stored.data;
  } catch {
    /* storage blocked */
  }
  return fromInvite ? 'invite' : undefined;
}
