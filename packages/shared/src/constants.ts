// Constants shared by web and server: agent identities, Nexconn message types, limits.
// Nexconn rules that shape these values (docs/NEXCONN.md):
//  - user and channel IDs: letters and digits only, <= 64 bytes, non-sequential.
//  - custom message types: <= 32 chars, must not start with "RC:" or "NC:", registered on the
//    client before connect.

export const AGENT_IDS = {
  pixel: 'agent-pixel',
  forge: 'agent-forge',
  glitch: 'agent-glitch',
} as const;
export type AgentKey = keyof typeof AGENT_IDS;
export type AgentId = (typeof AGENT_IDS)[AgentKey];

export interface AgentProfile {
  key: AgentKey;
  id: AgentId;
  /** Display name in chat (also the Nexconn user name). */
  displayName: string;
  role: 'Designer' | 'Builder' | 'Playtester';
  /** Design-system accent token (docs/DESIGN.md). */
  accent: 'violet' | 'amber' | 'cyan';
  /** Path of the avatar served by the web app (absolute URL = WEB_ORIGIN + path). */
  avatarPath: string;
  tagline: string;
}

export const AGENTS: Record<AgentKey, AgentProfile> = {
  pixel: {
    key: 'pixel',
    id: AGENT_IDS.pixel,
    displayName: 'Pixel · Designer',
    role: 'Designer',
    accent: 'violet',
    avatarPath: '/agents/pixel.svg',
    tagline: 'Turns your pitches into a game plan with a checklist.',
  },
  forge: {
    key: 'forge',
    id: AGENT_IDS.forge,
    displayName: 'Forge · Builder',
    role: 'Builder',
    accent: 'amber',
    avatarPath: '/agents/forge.svg',
    tagline: 'Builds the game as one self-contained HTML file.',
  },
  glitch: {
    key: 'glitch',
    id: AGENT_IDS.glitch,
    displayName: 'Glitch · Playtester',
    role: 'Playtester',
    accent: 'cyan',
    avatarPath: '/agents/glitch.svg',
    tagline: 'Plays every build, records a GIF and turns bug reports into tests.',
  },
};

export const AGENT_ID_LIST: readonly AgentId[] = Object.values(AGENT_IDS);
export const isAgentId = (id: string): id is AgentId => (AGENT_ID_LIST as readonly string[]).includes(id);

/** What an agent is doing right now; shown as a Chip next to its avatar. */
export const AGENT_STATES = ['idle', 'thinking', 'planning', 'building', 'testing', 'reproducing', 'waiting', 'blocked', 'error'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Custom Nexconn message types (prefix "CA:" = CrewArcade). Registered on the web client before connect. */
export const MESSAGE_TYPES = {
  /** Interactive card (plan, vote, build, playtest, bug, publish...). content = CardEnvelope JSON. */
  card: 'CA:Card',
  /** Agent-to-agent handoff, shown inline ("Pixel → Forge: plan approved, build v1"). */
  handoff: 'CA:Handoff',
  /** Agent state change (idle/building/testing...). Not persisted, not counted. */
  agentState: 'CA:AgentState',
  /** System notice (member joined, game room created, publish approved...). */
  notice: 'CA:Notice',
  /** Floating reaction in the Live Build Theater (open channel). Not persisted. */
  reaction: 'CA:Reaction',
} as const;
export type MessageTypeKey = keyof typeof MESSAGE_TYPES;
export type CustomMessageType = (typeof MESSAGE_TYPES)[MessageTypeKey];

/** Registration flags for NCEngine.registerCustomMessages (Nexconn spells it "isPersited"). */
export const MESSAGE_TYPE_REGISTRY: ReadonlyArray<{ messageType: CustomMessageType; isPersited: boolean; isCounted: boolean; isStatusMessage?: boolean }> = [
  { messageType: MESSAGE_TYPES.card, isPersited: true, isCounted: true },
  { messageType: MESSAGE_TYPES.handoff, isPersited: true, isCounted: false },
  { messageType: MESSAGE_TYPES.agentState, isPersited: false, isCounted: false, isStatusMessage: true },
  { messageType: MESSAGE_TYPES.notice, isPersited: true, isCounted: false },
  { messageType: MESSAGE_TYPES.reaction, isPersited: false, isCounted: false, isStatusMessage: true },
];

/** Nexconn built-in types we use. */
export const BUILTIN_MESSAGE_TYPES = {
  text: 'RC:TxtMsg',
  image: 'RC:ImgMsg',
  hdVoice: 'RC:HQVCMsg',
  stream: 'RC:StreamMsg',
} as const;

/** Nexconn channelType numbers (webhooks, metadata API). */
export const CHANNEL_TYPE = { direct: 1, group: 3, open: 4, system: 6, community: 10 } as const;

export const LIMITS = {
  /** Nexconn: content of a non-stream message <= 10 KB. */
  messageContentBytes: 10 * 1024,
  /** Nexconn: all chunks of one stream message <= 128 KB. */
  streamTotalBytes: 128 * 1024,
  /** Nexconn: metadata key <= 32 chars, value <= 4096 chars. */
  metadataKeyChars: 32,
  metadataValueChars: 4096,
  /** Nexconn Free plan: members per group channel. */
  groupMembers: 300,
  /** CrewArcade product limits. */
  crewMembers: 30,
  crewNameChars: 40,
  pitchChars: 280,
  chatTextChars: 1500,
  gameBytes: 150 * 1024,
  dailyBuildsPerUser: 5,
  dailyTranslationChars: 500,
} as const;

export const CREW_ROLES = ['owner', 'approver', 'member'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const GAME_STATUSES = ['planning', 'building', 'testing', 'awaiting_approval', 'published', 'failed'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const BUG_STATUSES = ['open', 'reproduced', 'not_reproduced', 'fixed'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

/** Languages offered for translation (Nexconn built-in translation codes). */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'mr', label: 'मराठी' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'ur', label: 'اردو' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = LANGUAGES.map(l => l.code) as [LanguageCode, ...LanguageCode[]];
