// FAKE_AGENTS=1: Forge's canned build. A small original catch-and-dodge game written for the GAME
// region, themed from the plan (title, hero emoji, colours), so demos and e2e tests get a real,
// playable game that passes checkHtml() and the engine playtest. Never a test fixture (CLAUDE.md:
// fixtures are test data, never shown as CrewArcade games).

const HEROES = ['☕', '🛵', '🐧', '🥭', '🐱', '🚀', '🦊', '🐢'];
const GOODS = ['⭐', '🍬', '💎', '🪙', '🍀'];
const BADS = ['🕳️', '🪨', '🌵', '💣', '🔥'];

function pickBy<T>(arr: readonly T[], seed: number): T {
  return arr[Math.abs(Math.trunc(seed)) % arr.length]!;
}

/** JS string literal, safe inside the generated code. */
const lit = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c');

export function fakeGameRegion(o: { title: string; pitch: string; seed: number; hindi: boolean; faster?: boolean }): string {
  const hero = pickBy(HEROES, o.seed);
  const good = pickBy(GOODS, o.seed >>> 3);
  const bad = pickBy(BADS, o.seed >>> 5);
  const help = o.hindi ? '← → चलो, सितारे पकड़ो, गड्ढों से बचो' : '← → to move. Catch the good stuff, dodge the rest.';
  const base = o.faster ? 1.35 : 1;
  return `// ${o.title}: catch ${good}, dodge ${bad}. Written by Forge (FAKE_AGENTS template).
let P, items, spawnIn, speed, lives, caught, hurt;

const Game = {
  title: ${lit(o.title)},
  pitch: ${lit(o.pitch.slice(0, 120))},
  help: ${lit(help)},
  controls: ['ArrowLeft', 'ArrowRight'],
  touch: [{ key: 'ArrowLeft', label: '◀', side: 'left' }, { key: 'ArrowRight', label: '▶', side: 'right' }],

  init() {
    P = { x: view.w / 2, y: view.h - 90, r: 26, vx: 0 };
    items = []; spawnIn = 0.4; speed = ${base}; lives = 3; caught = 0; hurt = 0;
  },
  resize() { if (P) { P.y = view.h - 90; P.x = clamp(P.x, P.r, view.w - P.r); } },

  update(dt) {
    speed = ${base} + runTime * 0.05;
    hurt = Math.max(0, hurt - dt);
    const dir = (keyDown('ArrowRight') || keyDown('KeyD') ? 1 : 0) - (keyDown('ArrowLeft') || keyDown('KeyA') ? 1 : 0);
    const maxV = Math.max(380, view.w * 0.75);
    P.vx += (dir * maxV - P.vx) * Math.min(1, dt * 12);
    P.x = clamp(P.x + P.vx * dt, P.r, view.w - P.r);

    spawnIn -= dt;
    if (spawnIn <= 0) {
      const isBad = rand() < 0.45;
      // Every few hazards aim at the player, so a run without input still ends.
      const aimed = isBad && rand() < 0.5;
      const x = aimed ? P.x : randRange(24, view.w - 24);
      items.push({ x, y: -30, vy: randRange(170, 260) * speed, bad: isBad, spin: randRange(-2, 2), a: 0 });
      spawnIn = Math.max(0.22, 0.75 / speed) * randRange(0.7, 1.2);
    }

    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.vy * dt; it.a += it.spin * dt;
      if (Math.hypot(it.x - P.x, it.y - P.y) < P.r + 18) {
        items.splice(i, 1);
        if (it.bad) {
          if (hurt > 0) continue;
          lives--; hurt = 0.8; shake(12); beep(150, 260, 'sawtooth', 0.12, 60);
          burst(P.x, P.y, { n: 30, speed: 320, color: [PAL.accent2, '#fff'], size: 5, life: 0.8 });
          if (lives <= 0) { gameOver(); return; }
        } else {
          caught++; addScore(10); popText('+10', it.x, P.y - 40, PAL.good); beep(880, 80, 'triangle', 0.08, 1320);
          burst(it.x, it.y, { n: 14, speed: 200, color: [PAL.accent, PAL.accent3], size: 4, life: 0.5 });
        }
        continue;
      }
      if (it.y > view.h + 40) items.splice(i, 1);
    }
    // Staying alive scores too.
    if (Math.floor(runTime) > Math.floor(runTime - dt)) addScore(1);
  },

  draw(c) {
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, P.y + P.r + 12, view.w, 2);
    for (const it of items) {
      c.save(); c.translate(it.x, it.y); c.rotate(it.a);
      text(it.bad ? ${lit(bad)} : ${lit(good)}, 0, 0, 30, '#fff', 'center');
      c.restore();
    }
    if (scene === 'over') return;
    c.globalAlpha = hurt > 0 && Math.floor(hurt * 12) % 2 ? 0.35 : 1;
    text(${lit(hero)}, P.x, P.y, 44, '#fff', 'center');
    c.globalAlpha = 1;
    for (let i = 0; i < lives; i++) text('❤️', 18 + i * 26, view.h - 24, 18, '#fff', 'center');
  },

  state() { return { playerX: Math.round(P.x), lives, caught, items: items.length, speed: +speed.toFixed(2) }; },
};`;
}

export function fakeBuildOutput(hint: { title?: string; pitch?: string; language?: string; change?: string; seed?: number }) {
  const title = (hint.title ?? 'Forge Rush').slice(0, 40);
  const pitch = hint.pitch ?? 'Catch the good stuff and dodge the rest.';
  const seed = hint.seed ?? title.length * 7919;
  const faster = /fast|speed|tez|तेज/i.test(hint.change ?? '');
  const code = fakeGameRegion({ title, pitch, seed, hindi: hint.language === 'hi', faster });
  return {
    outline: ['Player movement', 'Falling items + lives', 'Score + juice'].join('\n'),
    code,
    notes: [
      'Move with ← → (or the on-screen buttons).',
      'Catch the good items for +10, dodge the bad ones; 3 lives.',
      'It speeds up the longer you survive.',
      ...(hint.change ? [`Change: ${hint.change.slice(0, 120)}`] : []),
    ],
    orientation: 'portrait' as const,
    emoji: '🎮',
    colors: ['#7c5cff', '#ffb547'] as [string, string],
  };
}
