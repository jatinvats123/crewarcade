import fs from 'node:fs';
import path from 'node:path';
import { AGENTS, AGENT_STATES } from '@crewarcade/shared';
import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '@/env';
import { BUSY_STATES, STATE_LABEL } from '@/lib/agents';
import { cn } from '@/lib/cn';

const WEB = path.resolve(import.meta.dirname, '..');

describe('public env', () => {
  it('has safe defaults and validates URLs', () => {
    expect(parsePublicEnv({})).toEqual({
      NEXT_PUBLIC_API_ORIGIN: 'http://localhost:8080',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_NEXCONN_APP_KEY: '',
      NEXT_PUBLIC_DEV_PAGES: '0',
    });
    expect(() => parsePublicEnv({ NEXT_PUBLIC_DEV_PAGES: 'yes' })).toThrow(/NEXT_PUBLIC_DEV_PAGES/);
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_ORIGIN: 'not a url' })).toThrow(/NEXT_PUBLIC_API_ORIGIN/);
  });
  it('only declares NEXT_PUBLIC_ variables', () => {
    const example = fs.readFileSync(path.join(WEB, '.env.example'), 'utf8');
    const keys = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every(k => k!.startsWith('NEXT_PUBLIC_'))).toBe(true);
  });
});

describe('design system', () => {
  it('labels every agent state', () => {
    for (const s of AGENT_STATES) expect(STATE_LABEL[s]).toBeTruthy();
    expect(BUSY_STATES.has('building')).toBe(true);
    expect(BUSY_STATES.has('idle')).toBe(false);
  });
  it('defines every colour token for dark and light themes', () => {
    const css = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8');
    const blocks = css.split(/\[data-theme='light'\]/);
    for (const token of ['--bg', '--surface', '--text', '--dim', '--brand', '--pixel', '--forge', '--glitch', '--success', '--danger']) {
      expect(blocks[0]).toContain(`${token}:`);
      expect(blocks[1]).toContain(`${token}:`);
    }
    expect(css).toContain('prefers-reduced-motion');
  });
  it('defaults to the dark theme whatever the OS prefers', () => {
    const css = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8');
    expect(css).not.toContain('prefers-color-scheme');
  });
  it('serves an avatar for every agent', () => {
    for (const a of Object.values(AGENTS)) expect(fs.existsSync(path.join(WEB, 'public', a.avatarPath))).toBe(true);
  });
  it('joins class names', () => {
    expect(cn('a', false, null, 'b', undefined)).toBe('a b');
  });
});
