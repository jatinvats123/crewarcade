// Fast static check of a game's index.html: size, no network/external assets, the window.__crew
// test hook, the host score hook, GAME markers, a canvas, and JavaScript that parses.
// Pure (no browser): runs in milliseconds, so the builder gets feedback before any playtest.
import vm from 'node:vm';

export const MAX_GAME_BYTES = 150 * 1024;

export interface CheckResult {
  pass: boolean;
  /** Human-readable, numbered in order of appearance. Empty when pass is true. */
  problems: string[];
  sizeBytes: number;
}

/** Network / external-asset patterns. window.parent.postMessage is deliberately NOT here: it is
 *  the score hook, a message to the embedding page, not a request. */
const NETWORK: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:src|href|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\//gi, 'external src/href'],
  [/\bfetch\s*\(/g, 'fetch()'],
  [/\bimport\s*(?:\(\s*|[^;'"]*?from\s*)["'`]\s*(?:https?:)?\/\//gi, 'import from a URL'],
  [/\burl\(\s*["']?\s*(?:https?:)?\/\//gi, 'CSS url() to a URL'],
  [/@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//gi, 'CSS @import of a URL'],
  [/\bnew\s+(?:WebSocket|EventSource|RTCPeerConnection|Worker|SharedWorker)\s*\(/g, 'network socket or worker'],
  [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
  [/\bnavigator\s*\.\s*sendBeacon\b/g, 'navigator.sendBeacon'],
  [/\bimportScripts\s*\(/g, 'importScripts()'],
  [/<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|preload|prefetch|preconnect|dns-prefetch|modulepreload)/gi, '<link> resource'],
  [/<(?:iframe|object|embed)\b/gi, 'embedded frame/object'],
];

/** Leaving the game page (the sandbox can't stop a frame navigating itself; the player also closes
 *  a game whose frame loads a second page). Reading location (e.g. location.pathname) is fine. */
const NAVIGATION: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blocation\s*=(?!=)/g, 'location assignment'],
  [/\blocation\s*\.\s*(?:href|pathname|search|host|hostname|origin|protocol|port)\s*=(?!=)/g, 'location assignment'],
  [/\blocation\s*\.\s*(?:assign|replace)\s*\(/g, 'location.assign/replace'],
  [/\bwindow\s*\.\s*open\s*\(/g, 'window.open()'],
  [/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/gi, '<meta> refresh'],
  [/<form\b/gi, '<form>'],
];

const HOOK_MEMBERS = ['state()', 'start()', 'reset()', 'seed(', 'controls'] as const;

export function checkHtml(html: string): CheckResult {
  const problems: string[] = [];
  const sizeBytes = Buffer.byteLength(html);
  if (sizeBytes > MAX_GAME_BYTES) problems.push(`File is ${(sizeBytes / 1024).toFixed(1)} KB; the limit is ${MAX_GAME_BYTES / 1024} KB.`);

  const lineOf = (i: number) => html.slice(0, i).split('\n').length;
  for (const [re, what] of NETWORK)
    for (const m of html.matchAll(re)) problems.push(`Network/external asset (${what}) at line ${lineOf(m.index ?? 0)}: ${m[0].trim().slice(0, 80)}`);
  for (const [re, what] of NAVIGATION)
    for (const m of html.matchAll(re)) problems.push(`Page navigation (${what}) at line ${lineOf(m.index ?? 0)}: ${m[0].trim().slice(0, 80)}`);

  const hasHook = html.includes('window.__crew');
  if (!hasHook) problems.push('window.__crew test hook is missing (keep the starter engine).');
  else for (const k of HOOK_MEMBERS) if (!html.includes(k)) problems.push(`window.__crew looks incomplete: "${k}" not found.`);

  if (!html.includes("'crewarcade:score'") || !html.includes("'crewarcade:start'"))
    problems.push('Score hook is missing: the engine must post crewarcade:start and crewarcade:score to window.parent (keep the starter engine).');
  if (!html.includes('// === GAME START ===') || !html.includes('// === GAME END ===')) problems.push('GAME START / GAME END markers are missing.');
  if (!/<canvas\b/i.test(html)) problems.push('No <canvas> element found.');

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (!scripts.length) problems.push('No inline <script> found.');
  for (const [, attrs = '', code = ''] of scripts) {
    if (/\bsrc\s*=/i.test(attrs)) {
      problems.push(`Script with src is not allowed (inline everything): <script${attrs}>`);
      continue;
    }
    const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'module') continue; // JSON/data blocks
    try {
      new vm.Script(code, { filename: 'index.html' });
    } catch (e) {
      const err = e as Error;
      const at = (err.stack ?? '').match(/:(\d+)\n/);
      problems.push(`JavaScript syntax error: ${err.message}${at ? ` (script line ${at[1]})` : ''}`);
    }
  }
  return { pass: problems.length === 0, problems, sizeBytes };
}

/** One-line summary in the classic CLI format: "CHECK PASS" or "CHECK FAIL" + numbered problems. */
export function formatCheck(result: CheckResult, label = ''): string {
  const tag = label ? ` ${label}` : '';
  if (result.pass) return `CHECK PASS${tag}`;
  return [`CHECK FAIL${tag}`, ...result.problems.map((p, i) => `${i + 1}. ${p}`)].join('\n');
}
