// Link preview image for /g/<slug> (WhatsApp, iMessage, X, Discord...): 1200x630 PNG, a styled
// title card in the game's own colours: Glitch's mid-game playtest screenshot once the game is
// published (the emoji tile before that, or when the screenshot cannot be fetched).
// WhatsApp needs an absolute og:image URL (metadataBase), https, and a small file (PNG well under
// 300 KB). next/og (satori) cannot shape Indic scripts (vowel signs and conjuncts come out in the
// wrong order), so a title or crew name in those scripts is never drawn here: the card falls back to
// a Latin headline, and the preview's own text line (og:title, rendered by the phone) shows it.
import { ImageResponse } from 'next/og';
import { fetchPublicGame, ogCardText } from '@/lib/public-game';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A CrewArcade game';
export const revalidate = 300;

/** Google Fonts subset for exactly these characters (the documented next/og pattern). */
async function fontFor(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@700&text=${encodeURIComponent(text)}`)).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const hexOk = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await fetchPublicGame(slug);
  const { title, line } = ogCardText(game);
  const emoji = game?.emoji ?? '🎮';
  const [c1, c2] = game && game.colors.every(hexOk) ? game.colors : ['#7c5cff', '#ffb547'];
  const published = game?.publishedVersion !== null && game?.publishedVersion !== undefined;
  // Inline the screenshot (satori would fetch it too, but a dead link must not break the preview).
  let shot: string | null = null;
  if (published && game?.screenshotUrl) {
    try {
      const res = await fetch(game.screenshotUrl, { next: { revalidate: 300 } });
      if (res.ok && res.headers.get('content-type') === 'image/png') shot = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch {
      shot = null;
    }
  }
  const text = `${title}${line}`;
  const fonts: { name: string; data: ArrayBuffer; weight: 700; style: 'normal' }[] = [];
  const latin = await fontFor('Space Grotesk', `${text}▶ Play on CrewArcade Being built`);
  if (latin) fonts.push({ name: 'Display', data: latin, weight: 700, style: 'normal' });

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        background: `linear-gradient(135deg, #0b0a16 0%, #0b0a16 35%, ${c1} 100%)`,
        color: '#ffffff',
        fontFamily: 'Display, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, opacity: 0.9 }}>
        <div style={{ display: 'flex', width: 18, height: 18, borderRadius: 9, background: c2 }} />
        CrewArcade
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>
          <img src={shot} alt="" width={480} height={270} style={{ borderRadius: 28, border: `6px solid ${c2}`, objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 240,
              height: 240,
              borderRadius: 56,
              background: 'rgba(255,255,255,0.12)',
              border: `6px solid ${c2}`,
              fontSize: 150,
            }}
          >
            {emoji}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 18 }}>
          <div style={{ fontSize: title.length > 22 ? 64 : 84, lineHeight: 1.05, letterSpacing: -1 }}>{title}</div>
          <div style={{ fontSize: 30, opacity: 0.85 }}>{line}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', padding: '16px 34px', borderRadius: 999, background: c2, color: '#0b0a16', fontSize: 34 }}>
          {published ? '▶ Play on CrewArcade' : 'Being built'}
        </div>
        <div style={{ display: 'flex', fontSize: 26, opacity: 0.75 }}>Pixel · Forge · Glitch</div>
      </div>
    </div>,
    { ...size, emoji: 'twemoji', ...(fonts.length > 0 && { fonts }) },
  );
}
