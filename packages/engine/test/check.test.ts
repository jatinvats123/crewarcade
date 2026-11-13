import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_GAME_BYTES, checkHtml, formatCheck } from '../src/check';
import { starterHtml } from '../src/versions';

const starter = starterHtml();
const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'games');
const inject = (code: string) => starter.replace('// === GAME END ===', `${code}\n// === GAME END ===`);

describe('checkHtml', () => {
  it('passes the starter and every fixture version', () => {
    expect(checkHtml(starter)).toMatchObject({ pass: true, problems: [] });
    for (const slug of fs.readdirSync(FIXTURES).filter(f => !f.includes('.')))
      for (const v of fs.readdirSync(path.join(FIXTURES, slug)).filter(d => /^v\d+$/.test(d))) {
        const res = checkHtml(fs.readFileSync(path.join(FIXTURES, slug, v, 'index.html'), 'utf8'));
        expect(res.problems, `${slug} ${v}`).toEqual([]);
      }
  });

  it('allows the score hook postMessage to the parent frame', () => {
    expect(starter).toContain("window.parent.postMessage(msg, '*')");
    expect(checkHtml(inject("window.parent.postMessage({ type: 'crewarcade:score', score: 1 }, '*');")).pass).toBe(true);
  });

  it.each([
    ['fetch', "fetch('/api/scores');"],
    ['fetch to a URL', "fetch('https://evil.example/x');"],
    ['XMLHttpRequest', 'new XMLHttpRequest();'],
    ['WebSocket', "new WebSocket('wss://x.example');"],
    ['EventSource', "new EventSource('/s');"],
    ['sendBeacon', "navigator.sendBeacon('/x', 'y');"],
    ['dynamic import of a URL', "import('https://cdn.example/lib.js');"],
    ['worker', "new Worker('w.js');"],
  ])('flags network access: %s', (_name, code) => {
    const res = checkHtml(inject(code));
    expect(res.pass).toBe(false);
    expect(res.problems.join('\n')).toMatch(/Network\/external asset/);
  });

  it('flags external scripts, stylesheets, images and CSS urls', () => {
    const html = starter
      .replace('</head>', '<link rel="stylesheet" href="https://fonts.example/a.css"><style>body{background:url(//x.example/a.png)}</style></head>')
      .replace('<canvas id="c"></canvas>', '<canvas id="c"></canvas><img src="https://x.example/a.png"><script src="app.js"></script>');
    const text = checkHtml(html).problems.join('\n');
    expect(text).toMatch(/<link> resource/);
    expect(text).toMatch(/CSS url\(\)/);
    expect(text).toMatch(/external src\/href/);
    expect(text).toMatch(/Script with src is not allowed/);
  });

  it('flags a missing test hook, score hook, markers and canvas', () => {
    const broken = starter
      .replaceAll('window.__crew', 'window.__other')
      .replaceAll("'crewarcade:score'", "'score'")
      .replace('// === GAME START ===', '')
      .replace('<canvas id="c"></canvas>', '');
    const text = checkHtml(broken).problems.join('\n');
    expect(text).toMatch(/window\.__crew test hook is missing/);
    expect(text).toMatch(/Score hook is missing/);
    expect(text).toMatch(/GAME START \/ GAME END markers are missing/);
    expect(text).toMatch(/No <canvas> element/);
  });

  it('flags JavaScript syntax errors but ignores JSON data blocks', () => {
    expect(checkHtml(inject('const = 1;')).problems.join('\n')).toMatch(/JavaScript syntax error/);
    const withData = starter.replace('</body>', '<script type="application/json">{"not": js}</script></body>');
    expect(checkHtml(withData).pass).toBe(true);
  });

  it('enforces the 150 KB size limit', () => {
    const big = inject(`// ${'x'.repeat(MAX_GAME_BYTES)}`);
    const res = checkHtml(big);
    expect(res.pass).toBe(false);
    expect(res.problems[0]).toMatch(/limit is 150 KB/);
    expect(res.sizeBytes).toBeGreaterThan(MAX_GAME_BYTES);
  });

  it('formats results like the CLI', () => {
    expect(formatCheck(checkHtml(starter), 'starter')).toBe('CHECK PASS starter');
    expect(formatCheck(checkHtml(inject('fetch(1)')))).toMatch(/^CHECK FAIL\n1\. /);
  });
});
