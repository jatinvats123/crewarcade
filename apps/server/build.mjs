// Bundles the server and its DB scripts into dist/ with esbuild.
// Workspace packages (@crewarcade/*) ship TypeScript source, so they are bundled in; every other
// bare import (npm dependencies, node: builtins) stays external and loads from node_modules.
import { build } from 'esbuild';

const externalNpm = {
  name: 'external-npm',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, args => (args.path.startsWith('@crewarcade/') ? undefined : { path: args.path, external: true }));
  },
};

await build({
  entryPoints: { index: 'src/index.ts', migrate: 'src/db/migrate.ts', seed: 'src/db/seed.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalNpm],
  // Some bundled CJS-style helpers expect require(); provide it in ESM output.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
