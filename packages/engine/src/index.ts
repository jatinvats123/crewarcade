// @crewarcade/engine: the game engine starter, static checker, headless playtester, GIF clipper
// and versioning helpers. Contract and formats: docs/ENGINE.md.
export { SLUG_RE, isSlug, slugify } from './slug';
export { MAX_GAME_BYTES, checkHtml, formatCheck, type CheckResult } from './check';
export {
  KEYBOARD,
  StepSchema,
  ScenarioSchema,
  parseScenario,
  scenarioMs,
  expectLabels,
  bugStepIndex,
  type Step,
  type Scenario,
  type NamedScenario,
  type ParseResult,
} from './scenario';
export { SEED, VIEWPORT, PHONE_CPU_THROTTLE, launchBrowser, serveHtml, type GameState } from './player';
export { playtest, playtestReport, type PlaytestInput, type PlaytestResult, type PlaytestCheck, type ScenarioRef, type CheckKind } from './playtest';
export { clip, encodeGif, type ClipInput, type ClipResult, type ClipSide } from './clip';
export {
  GameSpecSchema,
  AcceptanceItemSchema,
  SpecChangeSchema,
  acceptanceFor,
  specToMarkdown,
  type GameSpec,
  type AcceptanceItem,
  type SpecChange,
} from './spec';
export {
  starterPath,
  starterHtml,
  nextVersion,
  replaceGameRegion,
  gameRegion,
  readHotfix,
  listVersions,
  versionDir,
  createVersion,
  type Hotfix,
} from './versions';
export { loadVersion, readScenarioFile, findRepro, REPRO_FILE } from './disk';
