'use client';

// Gallery demo of the Phase 2 chat pieces without Nexconn: the card renderers (with fake actions that
// behave like the server: votes, approval, change), a streamed Markdown reply, and the Agent Status
// Strip. Content here is sample data, not a CrewArcade game.
import { CARD_MESSAGE_TYPES, metaToStrings, parseCardMeta, applyVote, type AgentStateMessage, type AnyCard, type CardActionResponse } from '@crewarcade/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentStatusStrip } from '@/components/agents/AgentStatusStrip';
import { CardMessage } from '@/components/cards/CardMessage';
import { CardEnvProvider, type CardEnv } from '@/components/cards/context';
import { usePlayer } from '@/components/player/PlayerProvider';
import { Markdown } from '@/components/chat/Markdown';
import { Button } from '@/components/ui';
import { emptyChannel, type ChannelState, type ChatMessage } from '@/lib/chat/types';

const ME = 'uDemoViewer000001';
const CH = 'crewDemoChannel001';

const plan: AnyCard = {
  kind: 'plan',
  content: {
    v: 1,
    gameId: 'gDemo',
    version: 1,
    title: 'Sample Scooter Run',
    slug: 'sample-scooter-run',
    pitch: 'A sample plan: a cup on a scooter dodging potholes.',
    controls: { keyboard: 'Left/Right arrows switch lanes, Space hops', touch: 'Tap ◀ ▶ to switch lanes, tap the screen to hop' },
    coreLoop: 'Three lanes scroll toward you. Switch lanes and hop to dodge potholes and grab biscuits.',
    winLose: '3 lives; each pothole costs one. At 0 the run is over.',
    scoring: '+1 per second, +5 per biscuit.',
    lookAndFeel: 'Sunset gradient, emoji, steam puffs, small screen shake on hits.',
    sound: 'Beep on biscuits, splash on potholes.',
    acceptance: [
      { id: 'A1', text: 'state().score rises while playing.' },
      { id: 'A2', text: 'ArrowLeft/ArrowRight change state().lane.' },
      { id: 'A3', text: 'A pothole lowers state().lives by 1.' },
      { id: 'A4', text: "state().scene is 'over' when state().lives is 0." },
      { id: 'A5', text: 'state().speed after 20 s is higher than at the start.' },
    ],
    language: 'en',
    credits: ['Sample User'],
  },
};

const base = (key: string, card: AnyCard, meta: Record<string, unknown> = {}): ChatMessage => ({
  key,
  messageId: key,
  localId: null,
  channelId: CH,
  senderId: 'agentpixel',
  sentTime: 1,
  kind: 'card',
  rawType: CARD_MESSAGE_TYPES[card.kind],
  card,
  meta: metaToStrings(meta),
  direction: 'in',
  status: 'sent',
  needReceipt: false,
  receiptSent: false,
});

const forge = (key: string, content: Extract<AnyCard, { kind: 'build' }>['content'], meta: Record<string, unknown>): ChatMessage => ({
  ...base(key, { kind: 'build', content }, meta),
  senderId: 'agentforge',
});

const STREAM = 'Ooh, I love this! Planning *Sample Scooter Run*…\n\n- three lanes\n- **potholes** and biscuits\n- gets faster every 15 s';

export function CardsDemo() {
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => [
    base('DEMO-PLAN', plan, { status: 'pending', yes: 1, no: 0, voters: { uDemoOther: 'yes' } }),
    base(
      'DEMO-HANDOFF',
      {
        kind: 'handoff',
        content: {
          v: 1,
          gameId: 'gDemo',
          from: 'pixel',
          to: 'forge',
          task: 'Build v1 from this plan',
          contextSummary: 'Sample Scooter Run: 5 acceptance checks.',
          artifacts: [{ kind: 'plan', label: 'Plan v1', ref: 'DEMO-PLAN' }],
        },
      },
      { status: 'waiting' },
    ),
    base('DEMO-LINK', { kind: 'roomLink', content: { v: 1, channelId: 'gameDemoRoom0001', gameId: 'gDemo', title: '🎮 Sample Scooter Run', kind: 'game' } }),
    forge(
      'DEMO-BUILDING',
      { v: 1, gameId: 'gDemo', slug: 'sample-scooter-run', title: 'Sample Scooter Run', version: 2, reason: 'change', change: 'Make it faster' },
      {
        status: 'building',
        steps: [
          { t: 'Reading the plan', s: 'done' },
          { t: 'Player movement', s: 'done' },
          { t: 'Potholes + speed ramp', s: 'doing' },
          { t: 'Running checks', s: 'todo' },
          { t: 'Saving v2', s: 'todo' },
        ],
      },
    ),
    forge(
      'DEMO-BUILD',
      { v: 1, gameId: 'gDemo', slug: 'sample-scooter-run', title: 'Sample Scooter Run', version: 1, reason: 'build' },
      {
        status: 'ready',
        steps: ['Reading the plan', 'Player movement', 'Potholes + speed ramp', 'Score + juice', 'Running checks', 'Saving v1'].map(t => ({ t, s: 'done' })),
        sizeKb: 18.4,
        buildMs: 64_000,
        attempts: 1,
        notes: ['Steer with ← → or the on-screen buttons.', 'Dodge potholes, grab biscuits for +10.', 'The road speeds up every 15 s.'],
        checkPass: 'true',
      },
    ),
    forge(
      'DEMO-FAILED',
      { v: 1, gameId: 'gDemo', slug: 'sample-scooter-run', title: 'Sample Scooter Run', version: 3, reason: 'build' },
      {
        status: 'failed',
        steps: [
          { t: 'Reading the plan', s: 'done' },
          { t: 'Player movement', s: 'done' },
          { t: 'Running checks', s: 'failed' },
        ],
        attempts: 3,
        checkPass: 'false',
        problems: ['Network/external asset (fetch()) at line 412: fetch(', 'Game.state() is missing.'],
        error: "I couldn't get v3 past the checks after 3 tries. The problems are on the build card; tap Try again and I'll take another run at it.",
      },
    ),
    {
      ...base(
        'DEMO-TEST-PASS',
        {
          kind: 'test',
          content: {
            v: 1,
            gameId: 'gDemo',
            version: 1,
            pass: true,
            passed: 18,
            total: 18,
            fps: 58,
            failures: [],
            regressions: [],
            items: [
              { id: 'A1', text: 'state().score rises while playing', pass: true },
              { id: 'A2', text: 'Holding ArrowRight increases state().lane', pass: true },
              { id: 'A3', text: "state().scene becomes 'over' when state().lives reaches 0", pass: true },
            ],
            round: 0,
          },
        },
        { status: 'done', next: 'publish' },
      ),
      senderId: 'agentglitch',
    },
    {
      ...base(
        'DEMO-TEST-FAIL',
        {
          kind: 'test',
          content: {
            v: 1,
            gameId: 'gDemo',
            version: 2,
            pass: false,
            passed: 16,
            total: 18,
            fps: 55,
            failures: [{ label: 'key Space has an effect', detail: 'no change to state or picture after 600 ms' }],
            regressions: [],
            items: [
              { id: 'A1', text: 'state().score rises while playing', pass: true },
              { id: 'A2', text: 'Pressing Space makes state().jumping true', pass: false, detail: 'state.jumping === true -> state {"jumping":false}' },
            ],
            round: 2,
          },
        },
        { status: 'done', next: 'ask_crew' },
      ),
      senderId: 'agentglitch',
    },
    {
      ...base(
        'DEMO-PUBLISH',
        {
          kind: 'publish',
          content: {
            v: 1,
            gameId: 'gDemo',
            version: 1,
            arcadeUrl: 'https://crewarcade.test/g/sample-scooter-run',
            title: 'Sample Scooter Run',
            slug: 'sample-scooter-run',
          },
        },
        { status: 'waiting' },
      ),
      senderId: 'agentglitch',
    },
    {
      ...base('DEMO-SCORE', {
        kind: 'score',
        content: {
          v: 1,
          gameId: 'gDemo',
          slug: 'sample-scooter-run',
          title: 'Sample Scooter Run',
          version: 1,
          playerId: 'u1',
          playerName: 'Riya',
          score: 1240,
          rank: 1,
          beatPlayerId: 'u2',
          beatPlayerName: 'Rohan',
          beatScore: 990,
        },
      }),
      senderId: 'agentglitch',
    },
  ]);
  const player = usePlayer();
  const msgsRef = useRef(msgs);
  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  const env: CardEnv = useMemo(() => {
    const metaOf = (id: string) => msgsRef.current.find(m => m.messageId === id)?.meta ?? {};
    const answer = async (id: string, meta: Record<string, unknown>): Promise<CardActionResponse> => {
      await new Promise(r => setTimeout(r, 350));
      return { messageId: id, metadata: { ...metaOf(id), ...metaToStrings(meta) } };
    };
    return {
      crewId: 'cDemo',
      myId: ME,
      canApprove: true,
      roomHref: () => '#room',
      setMeta: (_c, id, metadata, replace) =>
        setMsgs(list => list.map(m => (m.messageId === id ? { ...m, meta: replace ? metadata : { ...m.meta, ...metadata } } : m))),
      actions: {
        vote: async (id, v) => {
          const current = parseCardMeta('plan', metaOf(id));
          const voters = { ...current.voters };
          delete voters[ME]; // the optimistic copy already counted me; recount like the server
          const next = applyVote(voters, ME, v);
          return answer(id, { yes: next.yes, no: next.no, voters: next.voters });
        },
        approve: id => answer(id, { status: 'approved', approvedBy: 'You', roomChannelId: 'gameDemoRoom0001' }),
        requestChange: id => answer(id, { status: 'changes_requested' }),
        retryBuild: async id => {
          setMsgs(list =>
            list.map(m => (m.messageId === id ? { ...m, meta: metaToStrings({ status: 'building', steps: [{ t: 'Reading the plan', s: 'doing' }] }) } : m)),
          );
          return { queued: true };
        },
        publish: (id, decision) =>
          answer(id, { status: decision === 'allow' ? 'approved' : 'rejected', decidedBy: 'You', decidedAt: new Date().toISOString() }),
        askForFix: async id => {
          await answer(id, { next: 'asked' });
          return { messageId: id, version: 3 };
        },
        play: (gameId, version, title) => player.open({ gameId, version, ...(title && { title }) }),
      },
    };
  }, [player]);

  // Streamed reply that types itself out; replay restarts it.
  const [n, setN] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => setN(x => (x >= STREAM.length ? x : x + 3)), 45);
    return () => clearInterval(t);
  }, [run]);

  const channel: ChannelState = useMemo(() => {
    const now = Date.now();
    const st = (s: Omit<AgentStateMessage, 'v'>) => ({ v: 1 as const, ...s, receivedAt: now });
    return {
      ...emptyChannel(),
      agentStates: {
        pixel: st({ agentId: 'pixel', state: 'thinking', detail: 'reading the pitch', startedAt: now - 4000 }),
        forge: st({ agentId: 'forge', state: 'building', detail: 'v1', startedAt: now - 32_000 }),
        glitch: st({ agentId: 'glitch', state: 'testing', detail: 'v1', startedAt: now - 9000, progress: { done: 12, total: 18 } }),
      },
    };
  }, []);

  return (
    <div className="flex w-full max-w-md flex-col gap-3" data-testid="cards-demo">
      <div className="overflow-hidden rounded-card border border-border">
        <AgentStatusStrip channel={channel} crewId="cDemo" />
      </div>
      <div className="flex flex-col items-start gap-1">
        <div className="max-w-[82%] rounded-3xl rounded-bl-lg bg-surface-2 px-3.5 py-2 text-[0.95rem]" aria-busy={n < STREAM.length || undefined}>
          <Markdown text={STREAM.slice(0, n)} caret={n < STREAM.length} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setRun(r => r + 1)}>
          ↻ Replay stream
        </Button>
      </div>
      <CardEnvProvider value={env}>
        {msgs.map(m => (
          <CardMessage key={m.key} m={m} />
        ))}
      </CardEnvProvider>
    </div>
  );
}
