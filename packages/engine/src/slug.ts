/** Game slugs: kebab-case, 3-30 chars of a-z, 0-9 and "-", no leading/trailing dash. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG_RE.test(s);

/**
 * Turns a title into a slug candidate ("Cat vs. Cucumbers!" -> "cat-vs-cucumbers").
 * Returns null when nothing usable is left (callers then pick a fallback such as "game-<id>").
 */
export function slugify(title: string): string | null {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return isSlug(s) ? s : null;
}
