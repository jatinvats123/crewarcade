// Stable two-colour palettes for art that has no colours of its own (crew cards, rooms).
const PALETTES: Array<[string, string]> = [
  ['#ffb547', '#2ec4b6'],
  ['#c2410c', '#fde68a'],
  ['#7c5cff', '#22d3ee'],
  ['#38bdf8', '#f472b6'],
  ['#22c55e', '#facc15'],
  ['#f472b6', '#a78bfa'],
];

/** The same id always gets the same pair. */
export const paletteFor = (id: string): [string, string] => PALETTES[[...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTES.length]!;
