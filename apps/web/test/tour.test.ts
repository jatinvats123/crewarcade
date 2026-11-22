// Judge tour: the 23 steps, their tick rules (from real app facts), the reducer behind Next / Skip /
// Show me, the facts read from chat cards and pages, and who sees the tour (judges only).
import type { AnyCard, PlanCardContent } from '@crewarcade/shared';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/lib/chat/types';
import {
  doneSteps,
  factsForPath,
  GROUPS,
  groupProgress,
  stepLabel,
  factsFromMessages,
  initialTourState,
  JUDGE_PITCHES,
  nextOpen,
  parseTourState,
  samePath,
  STEP_IDS,
  STEPS,
  stepById,
  TEST_INJECTION,
  tourEnabledFor,
  tourHiddenOn,
  tourReducer,
  tourView,
  type StepId,
  type TourState,
} from '../src/lib/tour/steps';

type M = Pick<ChatMessage, 'kind' | 'card' | 'meta' | 'notice' | 'blockedReason'>;
const card = (c: AnyCard, meta: Record<string, string> = {}): M => ({ kind: 'card', card: c, meta });

const plan = (over: Partial<PlanCardContent> = {}): PlanCardContent => ({
  v: 1,
  gameId: 'gRocket',
  version: 1,
  title: 'Star Dodge',
  slug: 'star-dodge',
  pitch: 'a rocket dodging falling stars',
  controls: { keyboard: 'arrows', touch: 'tap sides' },
  coreLoop: 'dodge stars, collect fuel',
  winLose: 'hit a star and lose',
  scoring: 'one point a second',
  lookAndFeel: 'neon night sky',
  sound: 'beeps',
  acceptance: [
    { id: 'A1', text: 'score goes up over time' },
    { id: 'A2', text: 'a star hit ends the run' },
    { id: 'A3', text: 'the rocket moves left' },
    { id: 'A4', text: 'the rocket moves right' },
  ],
  language: 'en',
  credits: [],
  ...over,
});

const facts = (...f: string[]) => new Set(f);
const doneFor = (...f: string[]) => doneSteps(facts(...f));
const state = (over: Partial<TourState> = {}): TourState => ({ ...initialTourState(), ...over });

describe('tour steps', () => {
  it('has the 23 steps in order, each saying what to press, what happens next and why', () => {
    expect(STEPS.map(s => s.id)).toEqual([...STEP_IDS]);
    expect(STEPS).toHaveLength(23);
    for (const s of STEPS) {
      expect(s.title.length, s.id).toBeGreaterThan(2);
      expect(s.press.length, s.id).toBeGreaterThan(10);
      expect(s.next.length, s.id).toBeGreaterThan(10);
      expect(s.why.length, s.id).toBeGreaterThan(10);
      expect(s.done, s.id).toMatch(/^Done: /);
    }
  });

  it('nothing is done before anything happened', () => {
    expect(doneFor().size).toBe(0);
  });

  it.each<[StepId, string[]]>([
    ['pitch', ['plan']],
    ['change', ['plan-v2']],
    ['approve', ['approved']],
    ['build', ['build-ready']],
    ['playtest', ['test']],
    ['retry', ['test-pass']],
    ['play', ['game:g1', 'play:g1']],
    ['play', ['game:g1', 'score:g1']],
    ['allow', ['published']],
    ['page', ['slug:star-dodge', 'visit:/g/star-dodge']],
    ['board', ['leaderboard']],
    ['bug', ['bug']],
    ['story', ['story']],
    ['story', ['story-export']],
    ['remix', ['remix']],
    ['shield', ['shield']],
    ['hindi', ['plan-hi']],
    ['translate', ['translate']],
    ['invite', ['invite']],
    ['invite', ['approver']],
    ['voice', ['info:voice']],
    ['voice', ['voice']],
    ['dm', ['info:dm']],
    ['numbers', ['visit:/impact', 'visit:/safety']],
    ['sandbox', ['info:sandbox']],
    ['arcade', ['score:gOther']],
    ['settings', ['visit:/settings']],
  ])('%s ticks on %j', (id, f) => {
    expect(doneFor(...f).has(id)).toBe(true);
  });

  it('a FAIL alone does not tick "try again"; a later PASS does', () => {
    expect(doneFor('test', 'test-fail').has('retry')).toBe(false);
    expect(doneFor('test', 'test-fail', 'test-pass').has('retry')).toBe(true);
  });

  it('playing another crew’s game does not tick "play it"; a score on your own game does not tick the Arcade step', () => {
    expect(doneFor('play:gOther').has('play')).toBe(false);
    expect(doneFor('game:g1', 'score:g1').has('arcade')).toBe(false);
    expect(doneFor('game:g1', 'score:g1', 'score:gOther').has('arcade')).toBe(true);
  });

  it('the game page step needs your own published game’s page, not any game page', () => {
    expect(doneFor('visit:/g/someone-elses').has('page')).toBe(false);
    expect(doneFor('slug:star-dodge', 'visit:/g/someone-elses').has('page')).toBe(false);
  });

  it('live numbers needs both /impact and /safety, and points at whichever is left', () => {
    expect(doneFor('visit:/impact').has('numbers')).toBe(false);
    const numbers = stepById('numbers');
    expect(numbers.where({}, facts())).toBe('/impact');
    expect(numbers.where({}, facts('visit:/impact'))).toBe('/safety');
  });

  it('steps know their page: the crew chat, the game room (falling back to the crew), or a fixed page', () => {
    const ctx = { crewPath: '/crews/c1', roomPath: '/crews/c1/rooms/r1' };
    expect(stepById('pitch').where(ctx, facts())).toBe('/crews/c1');
    expect(stepById('allow').where(ctx, facts())).toBe('/crews/c1/rooms/r1');
    expect(stepById('allow').where({ crewPath: '/crews/c1' }, facts())).toBe('/crews/c1');
    expect(stepById('remix').where(ctx, facts('slug:star-dodge'))).toBe('/g/star-dodge');
    expect(stepById('remix').where(ctx, facts())).toBe('/arcade');
    expect(stepById('arcade').where(ctx, facts())).toBe('/arcade');
    expect(stepById('settings').where(ctx, facts())).toBe('/settings');
    expect(stepById('dm').where(ctx, facts())).toBeNull();
  });

  it('Show me types a real prompt injection for the shield step and Hindi for the Hindi step', () => {
    expect(stepById('shield').fill).toBe(TEST_INJECTION);
    expect(TEST_INJECTION).toMatch(/ignore all previous instructions/);
    expect(stepById('hindi').fill).toMatch(/[ऀ-ॿ]/);
  });

  it('judge pitches are three chips, one of them in Hindi, each addressed to Pixel', () => {
    expect(JUDGE_PITCHES).toHaveLength(3);
    expect(JUDGE_PITCHES.every(p => p.text.startsWith('@pixel '))).toBe(true);
    expect(JUDGE_PITCHES.some(p => /[ऀ-ॿ]/.test(p.text))).toBe(true);
  });

  it('only the Arcade step stays on a game page that already has Play on screen', () => {
    expect(STEPS.filter(s => s.stayIfTarget).map(s => s.id)).toEqual(['arcade']);
    expect(stepById('arcade').targets[0]?.id).toBe('game-play');
  });

  it('the core loop comes first (6 steps), then four Explore themes; all 23 are kept', () => {
    expect(STEPS.slice(0, 6).map(s => s.id)).toEqual(['pitch', 'approve', 'build', 'playtest', 'play', 'allow']);
    expect(STEPS.slice(0, 6).every(s => s.group === 'core')).toBe(true);
    const sizes = groupProgress(new Set()).map(g => [g.id, g.total]);
    expect(sizes).toEqual([
      ['core', 6],
      ['fix', 5],
      ['safety', 3],
      ['crews', 5],
      ['arcade', 4],
    ]);
    // Groups are contiguous in tour order, so Next walks one theme at a time.
    const order = STEPS.map(s => s.group);
    expect(order).toEqual([...order].sort((a, b) => GROUPS.findIndex(g => g.id === a) - GROUPS.findIndex(g => g.id === b)));
  });

  it('info steps are the sandbox, voice and DM steps', () => {
    expect(STEPS.filter(s => s.info).map(s => s.id)).toEqual(['sandbox', 'voice', 'dm']);
  });
});

describe('tour reducer', () => {
  it('starts on step 1, 0 of 23 done, labelled as the core loop', () => {
    const v = tourView(initialTourState());
    expect(v).toMatchObject({ kind: 'step', index: 0, done: false, doneCount: 0, total: 23, core: { done: 0, total: 6 }, groupIndex: 0, groupTotal: 6 });
    if (v.kind === 'step') expect(stepLabel(v)).toBe('Core · step 1 of 6');
  });

  it('Explore steps are labelled by theme and position', () => {
    const v = tourView(state({ focus: 'sandbox' }));
    if (v.kind !== 'step') throw new Error('expected a step');
    expect(stepLabel(v)).toBe('Safety & trust · 2 of 3');
  });

  it('per-group progress counts ticks; finishing the core says so once, on its last done step', () => {
    const core = ['plan', 'approved', 'build-ready', 'test', 'game:g1', 'play:g1', 'published'];
    const v = tourView(state({ facts: [...core, 'shield'], focus: 'allow' }));
    if (v.kind !== 'step') throw new Error('expected a step');
    expect(v.core).toEqual({ done: 6, total: 6 });
    expect(v.coreJustDone).toBe(true);
    expect(v.groups.find(g => g.id === 'safety')).toMatchObject({ done: 1, total: 3 });
    // Not yet: one core step still open.
    const w = tourView(state({ facts: core.filter(f => f !== 'published'), focus: 'play' }));
    expect(w.kind === 'step' && w.coreJustDone).toBe(false);
    // Next from the last core step goes straight into Explore.
    expect(tourReducer(state({ facts: core, focus: 'allow' }), { type: 'next' }).focus).toBe('remix');
  });

  it('a finished step stays on the card as done until Next, which goes to the next open step', () => {
    let s = tourReducer(state(), { type: 'facts', facts: ['plan'] });
    expect(tourView(s)).toMatchObject({ kind: 'step', index: 0, done: true, doneCount: 1 });
    s = tourReducer(s, { type: 'next' });
    expect(s.focus).toBe('approve');
  });

  it('Next skips over steps already done out of order', () => {
    const s = tourReducer(state({ facts: ['plan', 'plan-v2', 'approved'] }), { type: 'next' });
    expect(s.focus).toBe('build');
  });

  it('facts are kept once and never removed', () => {
    const s1 = tourReducer(state(), { type: 'facts', facts: ['plan', 'plan', 'test'] });
    expect(s1.facts).toEqual(['plan', 'test']);
    const s2 = tourReducer(s1, { type: 'facts', facts: ['plan'] });
    expect(s2).toBe(s1);
  });

  it('Skip moves on and remembers the step; focusing it again un-skips it', () => {
    let s = tourReducer(state(), { type: 'skip', id: 'pitch' });
    expect(s.focus).toBe('approve');
    expect(s.skipped).toEqual(['pitch']);
    s = tourReducer(s, { type: 'focus', id: 'pitch' });
    expect(s.focus).toBe('pitch');
    expect(s.skipped).toEqual([]);
  });

  it('Got it on an info step ticks it', () => {
    const s = tourReducer(state({ focus: 'voice' }), { type: 'ack', id: 'voice' });
    expect(s.facts).toContain('info:voice');
    expect(tourView(s)).toMatchObject({ kind: 'step', done: true });
  });

  it('when every step is done or skipped the tour is complete, listing the skipped ones', () => {
    let s = state();
    for (const id of STEP_IDS) s = tourReducer(s, id === 'bug' || id === 'arcade' ? { type: 'skip', id } : { type: 'ack', id });
    // ack only ticks info steps; tick the rest with their facts
    s = tourReducer(s, {
      type: 'facts',
      facts: [
        'plan',
        'plan-v2',
        'approved',
        'build-ready',
        'test',
        'test-pass',
        'game:g1',
        'play:g1',
        'published',
        'slug:s1',
        'visit:/g/s1',
        'leaderboard',
        'story',
        'remix',
        'shield',
        'plan-hi',
        'translate',
        'invite',
        'visit:/impact',
        'visit:/safety',
        'visit:/settings',
      ],
    });
    s = tourReducer({ ...s, focus: 'settings' }, { type: 'next' });
    expect(s.focus).toBeNull();
    const v = tourView(s);
    expect(v.kind).toBe('complete');
    expect(v.kind === 'complete' && v.skipped.map(x => x.id)).toEqual(['bug', 'arcade']);
    expect(v.doneCount).toBe(21);
  });

  it('a skipped step that later gets done leaves the skipped list', () => {
    const s = state({ focus: null, skipped: ['bug'], facts: ['bug'] });
    const v = tourView(s);
    if (v.kind === 'complete') expect(v.skipped).toEqual([]);
  });

  it('nextOpen wraps round to earlier open steps', () => {
    expect(nextOpen({ facts: ['visit:/settings'], skipped: [] }, 'arcade')).toBe('pitch');
    expect(nextOpen({ facts: [], skipped: [...STEP_IDS] }, null)).toBeNull();
  });

  it('remembers the crew chat and game room, ignoring no-op updates', () => {
    const s1 = tourReducer(state(), { type: 'ctx', ctx: { crewPath: '/crews/c1' } });
    expect(s1.ctx).toEqual({ crewPath: '/crews/c1' });
    expect(tourReducer(s1, { type: 'ctx', ctx: { crewPath: '/crews/c1' } })).toBe(s1);
    expect(tourReducer(s1, { type: 'ctx', ctx: { roomPath: '/crews/c1/rooms/r1' } }).ctx).toEqual({ crewPath: '/crews/c1', roomPath: '/crews/c1/rooms/r1' });
  });
});

describe('saved progress (localStorage)', () => {
  it('round-trips and starts over on anything broken', () => {
    const s = tourReducer(tourReducer(state(), { type: 'facts', facts: ['plan'] }), { type: 'skip', id: 'change' });
    expect(parseTourState(JSON.stringify(s))).toEqual(s);
    expect(parseTourState(null)).toEqual(initialTourState());
    expect(parseTourState('{not json')).toEqual(initialTourState());
    expect(parseTourState(JSON.stringify({ ...s, focus: 'nope' }))).toEqual(initialTourState());
    expect(parseTourState(JSON.stringify({ ...s, ctx: { crewPath: 'https://evil.example' } }))).toEqual(initialTourState());
  });
});

describe('facts from chat', () => {
  it('reads plans: any plan, v2, Hindi, remix, approved', () => {
    expect(factsFromMessages([card({ kind: 'plan', content: plan() })]).sort()).toEqual(['game:gRocket', 'plan']);
    const f = factsFromMessages([card({ kind: 'plan', content: plan({ version: 2, language: 'hi', remixOf: 'Star Dodge' }) }, { status: 'approved' })]);
    expect(f).toEqual(expect.arrayContaining(['plan-v2', 'plan-hi', 'remix', 'approved']));
  });

  it('reads build ready, test pass/fail, publish approved with the slug, bug reproduced', () => {
    const build: AnyCard = { kind: 'build', content: { v: 1, gameId: 'g1', slug: 'star-dodge', title: 'Star Dodge', version: 1, reason: 'build' } };
    expect(factsFromMessages([card(build, { status: 'building' })])).not.toContain('build-ready');
    expect(factsFromMessages([card(build, { status: 'ready' })])).toContain('build-ready');

    const test = (pass: boolean): AnyCard => ({
      kind: 'test',
      content: { v: 1, gameId: 'g1', version: 1, pass, passed: 3, total: 4, fps: 60, failures: [], regressions: [], items: [], round: 0 },
    });
    expect(factsFromMessages([card(test(false))])).toEqual(expect.arrayContaining(['test', 'test-fail']));
    expect(factsFromMessages([card(test(true))])).toContain('test-pass');

    const pub: AnyCard = { kind: 'publish', content: { v: 1, gameId: 'g1', version: 1, arcadeUrl: 'https://crewarcade.vercel.app/g/star-dodge' } };
    expect(factsFromMessages([card(pub, { status: 'waiting' })])).not.toContain('published');
    expect(factsFromMessages([card(pub, { status: 'approved' })])).toEqual(expect.arrayContaining(['published', 'slug:star-dodge', 'game:g1']));
    expect(factsFromMessages([card(pub, { status: 'rejected' })])).not.toContain('published');

    const bug: AnyCard = { kind: 'bug', content: { v: 1, bugId: 'b1', gameId: 'g1', reporterId: 'u1', description: 'the rocket goes through stars' } };
    expect(factsFromMessages([card(bug, { status: 'open' })])).not.toContain('bug');
    expect(factsFromMessages([card(bug, { status: 'reproduced' })])).toContain('bug');
    expect(factsFromMessages([card(bug, { status: 'fixed' })])).toContain('bug');
  });

  it('reads the shield: a 🛡 notice, or our own message blocked before delivery', () => {
    expect(factsFromMessages([{ kind: 'notice', notice: { kind: 'shield', text: '🛡 Glitch removed a message' } }])).toEqual(['shield']);
    expect(factsFromMessages([{ kind: 'text', blockedReason: 'prompt_injection' }])).toEqual(['shield']);
    expect(factsFromMessages([{ kind: 'notice', notice: { kind: 'member_joined', text: 'Asha joined' } }])).toEqual([]);
  });

  it('ignores plain text and cards it cannot read', () => {
    expect(factsFromMessages([{ kind: 'text' }, { kind: 'card', card: null }])).toEqual([]);
  });
});

describe('facts from pages', () => {
  it('records /impact, /safety, /settings and game pages only', () => {
    expect(factsForPath('/impact')).toEqual(['visit:/impact']);
    expect(factsForPath('/safety')).toEqual(['visit:/safety']);
    expect(factsForPath('/settings')).toEqual(['visit:/settings']);
    expect(factsForPath('/g/star-dodge')).toEqual(['visit:/g/star-dodge']);
    expect(factsForPath('/arcade')).toEqual([]);
    expect(factsForPath('/crews/c1')).toEqual([]);
  });

  it('compares pages without query or trailing slash', () => {
    expect(samePath('/crews/c1?pitch=x', '/crews/c1')).toBe(true);
    expect(samePath('/crews/c1/', '/crews/c1')).toBe(true);
    expect(samePath('/crews/c1/rooms/r1', '/crews/c1')).toBe(false);
  });
});

describe('who sees the tour', () => {
  it('judges only: never ordinary players, agents or signed-out visitors', () => {
    expect(tourEnabledFor({ isJudge: true, isAgent: false })).toBe(true);
    expect(tourEnabledFor({ isJudge: false, isAgent: false })).toBe(false);
    expect(tourEnabledFor({ isJudge: true, isAgent: true })).toBe(false);
    expect(tourEnabledFor(null)).toBe(false);
    expect(tourEnabledFor(undefined)).toBe(false);
  });

  it('stays off the landing, judge start, sign-up, invite and dev pages', () => {
    for (const p of ['/', '/try', '/start', '/start?next=/crews', '/i/ABC123', '/dev/ui']) expect(tourHiddenOn(p), p).toBe(true);
    for (const p of ['/crews', '/crews/c1', '/settings', '/impact', '/safety', '/arcade', '/g/star-dodge']) expect(tourHiddenOn(p), p).toBe(false);
  });
});
