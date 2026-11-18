// Security: a malicious game must fail every attempt to reach the network, the top window, the
// parent page's DOM, cookies or storage. It runs exactly like a real game: served with the server's
// game headers (strict CSP) inside an iframe with the web player's sandbox attribute, on a page that
// holds a secret cookie, localStorage entry and DOM node. Any request reaching /canary fails the test.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchBrowser } from '@crewarcade/engine';
import { GAME_ALLOW, GAME_SANDBOX } from '@crewarcade/shared';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameHeaders } from '../src/services/play';

/** Each attempt returns 'blocked' or a string describing what leaked. */
const HOSTILE_GAME = (canary: string) => `<!doctype html><meta charset="utf-8"><title>totally a game</title>
<body><script>
const C = ${JSON.stringify(canary)};
const results = {};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function attempt(name, fn) {
  try { const r = await fn(); results[name] = r === undefined || r === null || r === false ? 'blocked' : 'LEAK: ' + String(r).slice(0, 80); }
  catch (e) { results[name] = 'blocked'; }
}
(async () => {
  await attempt('fetch', async () => { const r = await fetch(C + '/fetch'); return 'status ' + r.status; });
  await attempt('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', C + '/xhr'); x.onload = () => ok('status ' + x.status); x.onerror = () => ok(null); x.send(); }));
  await attempt('beacon', () => navigator.sendBeacon(C + '/beacon', 'x') ? null : null);
  await attempt('websocket', () => new Promise(ok => { const ws = new WebSocket(C.replace('http', 'ws') + '/ws'); ws.onopen = () => ok('open'); ws.onerror = () => ok(null); setTimeout(() => ok(null), 1500); }));
  await attempt('image', () => new Promise(ok => { const i = new Image(); i.onload = () => ok('loaded'); i.onerror = () => ok(null); i.src = C + '/img.png'; }));
  await attempt('script tag', () => new Promise(ok => { const s = document.createElement('script'); s.src = C + '/x.js'; s.onload = () => ok('loaded'); s.onerror = () => ok(null); document.body.appendChild(s); }));
  await attempt('stylesheet', () => new Promise(ok => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = C + '/x.css'; l.onload = () => ok('loaded'); l.onerror = () => ok(null); document.head.appendChild(l); }));
  await attempt('child iframe', async () => { const f = document.createElement('iframe'); f.src = C + '/frame'; document.body.appendChild(f); await wait(800); return null; });
  await attempt('form post', async () => { const f = document.createElement('form'); f.method = 'POST'; f.action = C + '/form'; f.target = '_blank'; document.body.appendChild(f); f.submit(); await wait(500); return null; });
  await attempt('window.open', () => { const w = window.open(C + '/popup'); return w ? 'opened' : null; });
  await attempt('top navigation', async () => { window.top.location.href = C + '/top'; await wait(500); return null; });
  await attempt('parent DOM', () => window.parent.document.getElementById('secret').textContent);
  await attempt('top DOM', () => window.top.document.cookie);
  await attempt('parent localStorage', () => window.parent.localStorage.getItem('secret'));
  await attempt('cookie read', () => document.cookie || null);
  await attempt('cookie write', () => { document.cookie = 'pwned=1'; return document.cookie.includes('pwned') ? 'written' : null; });
  await attempt('localStorage', () => { localStorage.setItem('x', '1'); return 'usable'; });
  await attempt('sessionStorage', () => { sessionStorage.setItem('x', '1'); return 'usable'; });
  await attempt('indexedDB', () => new Promise(ok => { const r = indexedDB.open('x'); r.onsuccess = () => ok('opened'); r.onerror = () => ok(null); }));
  await attempt('service worker', async () => { await navigator.serviceWorker.register(C + '/sw.js'); return 'registered'; });
  await attempt('alert', () => { alert('hi'); return null; });
  parent.postMessage({ type: 'hostile:done', results }, '*');
})();
</script></body>`;

let browser: Browser;
let server: Server;
let origin = '';
const canaryHits: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/canary')) {
      canaryHits.push(`${req.method} ${url}`);
      res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (url === '/game') {
      res.writeHead(200, gameHeaders({ ancestors: [origin], published: true })).end(HOSTILE_GAME(`${origin}/canary`));
      return;
    }
    // The "web app" page: secret cookie, storage and DOM, the game in the player's sandbox.
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'session=SECRET-SESSION; Path=/' })
      .end(
        `<!doctype html><body><p id="secret">SECRET-DOM</p><script>localStorage.setItem('secret','SECRET-LS');window.got=null;addEventListener('message',e=>{if(e.data&&e.data.type==='hostile:done')window.got=e.data.results;});</script>` +
          `<iframe id="g" sandbox="${GAME_SANDBOX}" allow="${GAME_ALLOW}" referrerpolicy="no-referrer" src="/game" style="width:400px;height:300px"></iframe></body>`,
      );
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise(r => server?.close(r));
});

describe('a malicious game in the player sandbox', () => {
  it('fails every attempt: network, top navigation, popups, parent DOM, cookies and storage', async () => {
    const page = await browser.newPage();
    const dialogs: string[] = [];
    page.on('dialog', d => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    try {
      await page.goto(`${origin}/host`);
      await page.waitForFunction(() => (window as unknown as { got: unknown }).got !== null, undefined, { timeout: 20_000 });
      const results = (await page.evaluate(() => (window as unknown as { got: Record<string, string> }).got)) as Record<string, string>;
      const leaks = Object.entries(results).filter(([, v]) => v !== 'blocked');
      expect(leaks).toEqual([]);
      expect(Object.keys(results)).toHaveLength(21);
      // Nothing reached the network, the top window stayed put, the parent's secrets are intact.
      expect(canaryHits).toEqual([]);
      expect(page.url()).toBe(`${origin}/host`);
      expect(await page.evaluate(() => [document.getElementById('secret')?.textContent, localStorage.getItem('secret'), document.cookie])).toEqual([
        'SECRET-DOM',
        'SECRET-LS',
        'session=SECRET-SESSION',
      ]);
      expect(page.context().pages()).toHaveLength(1);
      expect(dialogs).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
