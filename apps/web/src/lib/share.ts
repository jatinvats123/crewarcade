// Invite sharing: the native share sheet on phones (WhatsApp-ready text), clipboard on desktop.

export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/i/${code}`;
}

/** One message that reads well in WhatsApp (the link goes in the text: some apps drop `url`). */
export function inviteText(crewName: string, url: string): string {
  return `Join my crew "${crewName}" on CrewArcade 🎮 We pitch games and 3 AI agents build them with us. Tap to join: ${url}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareInvite(crewName: string, url: string): Promise<ShareResult> {
  const text = inviteText(crewName, url);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (coarse && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: `Join ${crewName} on CrewArcade`, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
