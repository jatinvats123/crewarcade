// Live agent states per room. Each change is sent at once as a CA:AgentState status message; while
// an agent is busy the same state is re-sent every 5 s (heartbeat), so people who open the room
// mid-work see it within seconds and a stale "thinking" disappears if the process dies (clients
// expire states that stop beating). GET /api/rooms/:channelId/agents serves the current snapshot.
import { AgentStateMessage, type AgentKey, type AgentState } from '@crewarcade/shared';

/** States that keep a heartbeat going. */
export const BUSY: ReadonlySet<AgentState> = new Set(['thinking', 'designing', 'building', 'checking', 'testing', 'fixing']);
export const HEARTBEAT_MS = 5000;

export interface AgentStatesDeps {
  send: (channelId: string, s: AgentStateMessage) => Promise<void>;
  now: () => number;
  heartbeatMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (t: unknown) => void;
  onError?: (err: unknown) => void;
}

export interface AgentStates {
  set(
    channelId: string,
    agent: AgentKey,
    state: AgentState,
    opts?: { detail?: string; gameId?: string; progress?: { done: number; total: number } },
  ): Promise<void>;
  /** Tells clients the messageId of a stream reply being written (kept until the next set()). */
  announceStream(channelId: string, agent: AgentKey, streamId: string): Promise<void>;
  /** Current non-idle states of a room. */
  snapshot(channelId: string): AgentStateMessage[];
  stopAll(): void;
}

export function createAgentStates(d: AgentStatesDeps): AgentStates {
  const current = new Map<string, AgentStateMessage>();
  const beats = new Map<string, unknown>();
  const every = d.setInterval ?? ((fn, ms) => setInterval(fn, ms).unref());
  const stop = d.clearInterval ?? (t => clearInterval(t as NodeJS.Timeout));
  const key = (c: string, a: AgentKey) => `${c}|${a}`;
  const safeSend = (c: string, s: AgentStateMessage) => d.send(c, s).catch(err => d.onError?.(err));

  return {
    async set(channelId, agent, state, opts = {}) {
      const k = key(channelId, agent);
      const prev = current.get(k);
      const msg = AgentStateMessage.parse({
        v: 1,
        agentId: agent,
        state,
        detail: opts.detail ?? '',
        // A new state starts its own clock; a progress update keeps it.
        startedAt: prev && prev.state === state ? prev.startedAt : d.now(),
        ...(opts.gameId && { gameId: opts.gameId }),
        ...(opts.progress && { progress: opts.progress }),
      });
      if (state === 'idle') current.delete(k);
      else current.set(k, msg);
      const beat = beats.get(k);
      if (beat !== undefined && !BUSY.has(state)) {
        stop(beat);
        beats.delete(k);
      }
      if (BUSY.has(state) && beat === undefined)
        beats.set(
          k,
          every(() => {
            const s = current.get(k);
            if (s) void safeSend(channelId, s);
          }, d.heartbeatMs ?? HEARTBEAT_MS),
        );
      await safeSend(channelId, msg);
    },
    async announceStream(channelId, agent, streamId) {
      const k = key(channelId, agent);
      const prev = current.get(k);
      const msg = AgentStateMessage.parse({ ...(prev ?? { v: 1, agentId: agent, state: 'thinking', detail: '', startedAt: d.now() }), streamId });
      if (prev) current.set(k, msg);
      await safeSend(channelId, msg);
    },
    snapshot(channelId) {
      return [...current.entries()].filter(([k]) => k.startsWith(`${channelId}|`)).map(([, v]) => v);
    },
    stopAll() {
      for (const t of beats.values()) stop(t);
      beats.clear();
    },
  };
}
