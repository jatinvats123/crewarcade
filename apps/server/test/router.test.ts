// Intent detection: a table of 40 real-looking messages in English, Hindi and Hinglish.
import { describe, expect, it } from 'vitest';
import { findMentions, routeMessage, type RouteInput } from '../src/agents/router';

type Expect = null | { agent: 'pixel' | 'forge' | 'glitch'; kind: string; text?: string; remix?: { source: string; idea: string } };
interface Row {
  text: string;
  /** Defaults: crew room, 3 humans, no structured mentions. */
  room?: 'crew' | 'game';
  humans?: number;
  mentions?: string[];
  want: Expect;
}

const ROWS: Row[] = [
  // English, mentions
  { text: '@pixel a chai cup on a scooter dodging potholes', want: { agent: 'pixel', kind: 'plan', text: 'a chai cup on a scooter dodging potholes' } },
  { text: '@Pixel A penguin that slides down icy hills', want: { agent: 'pixel', kind: 'plan', text: 'A penguin that slides down icy hills' } },
  { text: 'hey @PIXEL make a game where cats dodge cucumbers', want: { agent: 'pixel', kind: 'plan', text: 'hey make a game where cats dodge cucumbers' } },
  { text: 'a mango that jumps over trains', mentions: ['agentpixel'], want: { agent: 'pixel', kind: 'plan', text: 'a mango that jumps over trains' } },
  { text: '@pixel hi', want: { agent: 'pixel', kind: 'chat' } },
  { text: '@pixel thanks!', want: { agent: 'pixel', kind: 'chat' } },
  { text: '@pixel can you make it rain?', want: { agent: 'pixel', kind: 'chat' } },
  { text: '@pixel make it faster', want: { agent: 'pixel', kind: 'change', text: 'make it faster' } },
  { text: '@pixel add a boss level at the end', want: { agent: 'pixel', kind: 'change', text: 'add a boss level at the end' } },
  { text: '@pixel explain how does the jump work?', room: 'game', want: { agent: 'pixel', kind: 'explain', text: 'explain how does the jump work?' } },
  { text: '@pixel how does scoring work', room: 'game', want: { agent: 'pixel', kind: 'explain' } },
  { text: '@forge when do you start?', want: { agent: 'forge', kind: 'chat' } },
  { text: '@glitch did it pass?', room: 'game', want: { agent: 'glitch', kind: 'chat' } },
  { text: '@glitch bug: the cat walks through walls', room: 'game', want: { agent: 'glitch', kind: 'bug', text: 'the cat walks through walls' } },
  {
    text: '@pixel remix Chai Dash into a Diwali night version',
    want: { agent: 'pixel', kind: 'remix', remix: { source: 'Chai Dash', idea: 'a Diwali night version' } },
  },
  { text: 'email me at pixel@example.com about the trip', want: null },
  { text: 'I love @pixelart accounts', want: null },
  // English, commands without a mention
  { text: 'bug: score resets when I pause', room: 'game', want: { agent: 'glitch', kind: 'bug', text: 'score resets when I pause' } },
  {
    text: 'remix "Comet Dash" into an underwater chase',
    want: { agent: 'pixel', kind: 'remix', remix: { source: 'Comet Dash', idea: 'an underwater chase' } },
  },
  { text: 'pitch: frogs racing on lily pads', want: { agent: 'pixel', kind: 'plan', text: 'frogs racing on lily pads' } },
  { text: 'make it faster', want: null },
  { text: 'lol that was fun', want: null },
  { text: 'who is coming tonight?', want: null },
  // Solo crew: no mention needed
  { text: 'a dragon who delivers pizza across rooftops', humans: 1, want: { agent: 'pixel', kind: 'plan' } },
  { text: 'make it faster and add coins', humans: 1, want: { agent: 'pixel', kind: 'change' } },
  { text: 'hello', humans: 1, want: null },
  { text: 'what should I build?', humans: 1, want: null },
  { text: 'a cool game', humans: 1, want: { agent: 'pixel', kind: 'plan' } },
  { text: 'a dragon who delivers pizza', room: 'game', humans: 1, want: null },
  { text: 'how does the jump work', room: 'game', humans: 1, want: { agent: 'pixel', kind: 'explain' } },
  // Hindi (Devanagari)
  { text: '@पिक्सेल एक चाय का कप जो स्कूटर पर गड्ढों से बचता है', want: { agent: 'pixel', kind: 'plan', text: 'एक चाय का कप जो स्कूटर पर गड्ढों से बचता है' } },
  { text: 'पिक्सेल, दिवाली पर पटाखे पकड़ने वाला गेम बनाओ', want: { agent: 'pixel', kind: 'plan', text: 'दिवाली पर पटाखे पकड़ने वाला गेम बनाओ' } },
  { text: '@पिक्सेल इसे और तेज़ बनाओ', want: { agent: 'pixel', kind: 'change' } },
  { text: '@पिक्सेल समझाओ कूद कैसे काम करता है', room: 'game', want: { agent: 'pixel', kind: 'explain' } },
  { text: 'बग: स्कोर शून्य हो जाता है', room: 'game', want: { agent: 'glitch', kind: 'bug', text: 'स्कोर शून्य हो जाता है' } },
  { text: '@ग्लिच क्या टेस्ट पास हुआ', room: 'game', want: { agent: 'glitch', kind: 'chat' } },
  // Hinglish
  { text: '@pixel ek chai cup jo scooter pe potholes se bachta hai', want: { agent: 'pixel', kind: 'plan' } },
  {
    text: 'pixel bhai ek cricket wala game banao jisme ball dodge karna hai',
    want: { agent: 'pixel', kind: 'plan', text: 'ek cricket wala game banao jisme ball dodge karna hai' },
  },
  { text: '@pixel isko thoda fast karo', want: { agent: 'pixel', kind: 'change' } },
  { text: 'Chai Dash ko Holi version mein remix karo', want: { agent: 'pixel', kind: 'remix', remix: { source: 'Chai Dash', idea: 'Holi version' } } },
  { text: '@pixel jump kaise kaam karta hai', room: 'game', want: { agent: 'pixel', kind: 'explain' } },
  { text: 'yaar kal milte hai', want: null },
];

describe('router: 40+ messages in English, Hindi and Hinglish', () => {
  it('has at least 40 rows', () => expect(ROWS.length).toBeGreaterThanOrEqual(40));
  for (const row of ROWS) {
    it(`${row.text}`, () => {
      const input: RouteInput = { text: row.text, mentionedUserIds: row.mentions ?? [], roomKind: row.room ?? 'crew', humanCount: row.humans ?? 3 };
      const got = routeMessage(input);
      if (row.want === null) expect(got).toBeNull();
      else expect(got).toMatchObject(row.want);
    });
  }
});

describe('mentions', () => {
  it('collects structured and text mentions once each, in order', () => {
    expect(findMentions('@glitch and @pixel look', ['agentpixel', 'agentforge', 'u123'])).toEqual({ agents: ['glitch', 'pixel', 'forge'], rest: 'and look' });
  });
  it('ignores empty messages', () => {
    expect(routeMessage({ text: '   ', mentionedUserIds: ['agentpixel'], roomKind: 'crew', humanCount: 1 })).toBeNull();
  });
});
