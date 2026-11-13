// pnpm --filter @crewarcade/engine new-version <slug> [--from <other-slug>] [--games <dir>]
// Creates <games>/<slug>/v<N+1>/index.html from the latest version, or from the starter if none.
// --from <other-slug> (remixes): v1 of <slug> starts from the latest version of <other-slug>.
import { createVersion } from '../versions';
import { die, flag, gamesDir, positionals } from './args';

const argv = process.argv.slice(2);
const [slug] = positionals(argv, ['--games', '--from']);
if (!slug) die('Usage: new-version <slug> [--from <other-slug>] [--games <dir>]', 2);
try {
  const { version, source } = createVersion(gamesDir(argv), slug, { from: flag(argv, '--from') ?? undefined });
  console.log(`NEW VERSION ${version}: ${slug}/v${version}/index.html (copied from ${source})`);
} catch (e) {
  die((e as Error).message);
}
