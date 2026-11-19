// Rooms: a Nexconn group channel is either a crew's main chat or one game's room. Game rooms are
// created when a plan is approved: same members as the crew (humans + the three agents).
import { AGENT_ID_LIST, newId, nexconnUserId } from '@crewarcade/shared';
import type { Ctx } from '../context';
import { createGroup, joinGroup } from '../nexconn/api';
import { getCrew, getCrewByChannel, listMembers, type CrewRow } from '../repo/crews';
import { getGame, getGameByRoom, type GameRow } from '../repo/games';
import { ensureRegistered, requireNexconn } from './chat-users';
import { CREW_GROUP_PERMISSIONS } from './crews';

export type Room = { kind: 'crew'; crew: CrewRow; game: null } | { kind: 'game'; crew: CrewRow; game: GameRow };

// Which crew/game a channel belongs to never changes, so that mapping is remembered (per process,
// bounded); the rows themselves are always read fresh, in parallel. A game room then costs one round
// trip instead of three sequential ones (Supabase is 70-440 ms away from Render Singapore).
type ChannelOwner = { kind: 'crew'; crewId: string } | { kind: 'game'; crewId: string; gameId: string };
const channelOwners = new WeakMap<object, Map<string, ChannelOwner>>();
const ownersOf = (db: object) => {
  let m = channelOwners.get(db);
  if (!m) channelOwners.set(db, (m = new Map()));
  return m;
};

export async function resolveRoom(ctx: Pick<Ctx, 'db'>, channelId: string): Promise<Room | null> {
  const owners = ownersOf(ctx.db);
  const known = owners.get(channelId);
  if (known) {
    const [crew, game] = await Promise.all([getCrew(ctx.db, known.crewId), known.kind === 'game' ? getGame(ctx.db, known.gameId) : null]);
    if (crew && known.kind === 'crew') return { kind: 'crew', crew, game: null };
    if (crew && game) return { kind: 'game', crew, game };
    owners.delete(channelId); // deleted since: look it up again below
  }
  const remember = (o: ChannelOwner) => {
    owners.set(channelId, o);
    if (owners.size > 5000) owners.delete(owners.keys().next().value!);
  };
  const crew = await getCrewByChannel(ctx.db, channelId);
  if (crew) {
    remember({ kind: 'crew', crewId: crew.id });
    return { kind: 'crew', crew, game: null };
  }
  const game = await getGameByRoom(ctx.db, channelId);
  if (!game) return null;
  const owner = await getCrew(ctx.db, game.crewId);
  if (!owner) return null;
  remember({ kind: 'game', crewId: owner.id, gameId: game.id });
  return { kind: 'game', crew: owner, game };
}

/** "🎮 Chai Dash": Nexconn group names are <= 64 chars. */
export const gameRoomName = (title: string) => `🎮 ${title}`.slice(0, 64);

/** Creates the game room group channel with every crew member (owner = crew owner). Returns its id. */
export async function createGameRoom(ctx: Ctx, crew: CrewRow, game: Pick<GameRow, 'id' | 'title'>): Promise<string> {
  const nexconn = requireNexconn(ctx);
  const members = await listMembers(ctx.db, crew.id);
  const humans = members.filter(m => !m.isAgent).map(m => m.id);
  await ensureRegistered(ctx, [...humans, ...AGENT_ID_LIST]);
  const others = [...humans.filter(id => id !== crew.ownerId), ...AGENT_ID_LIST].map(nexconnUserId);
  const channelId = newId('gameChannel');
  // create takes <= 30 userIds; anyone beyond that joins right after.
  await createGroup(nexconn, {
    channelId,
    name: gameRoomName(game.title),
    owner: nexconnUserId(crew.ownerId),
    userIds: others.slice(0, 30),
    groupProfile: { introduction: `Game room for ${game.title.slice(0, 40)}: plan, builds, playtests.` },
    permissions: CREW_GROUP_PERMISSIONS,
    // No groupExtProfile: ext_ keys must be registered for the app first or create fails (25415).
  });
  for (let i = 30; i < others.length; i += 100) await joinGroup(nexconn, { channelId, userIds: others.slice(i, i + 100) });
  ctx.log.info({ crewId: crew.id, gameId: game.id, channelId, members: others.length + 1 }, 'game room created');
  return channelId;
}
