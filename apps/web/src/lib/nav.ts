/** Only same-site paths are allowed as ?next= targets (no "//evil.com", no schemes). Tested. */
export const safeNext = (n: string | null | undefined, fallback = '/crews'): string => (n && /^\/(?!\/)[\w\-/]*$/.test(n) ? n : fallback);
