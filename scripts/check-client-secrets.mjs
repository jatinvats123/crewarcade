#!/usr/bin/env node
// CI guard: server-only secret names must never appear in browser code.
// Fails if any of them appears in apps/web (source, config, env examples) or in packages/shared
// (which the browser bundle imports), or if any NEXT_PUBLIC_* variable looks like a secret.
// Usage: node scripts/check-client-secrets.mjs [--build]   (--build also scans apps/web/.next/static)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_NAMES = [
  'NEXCONN_APP_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'ANTHROPIC_API_KEY',
  'SARVAM_API_KEY',
  'TOKEN_ENCRYPTION_KEY',
  'DATABASE_URL',
];
// A NEXT_PUBLIC_ name containing any of these words is treated as a leaked secret.
const SECRETY = /SECRET|SERVICE_ROLE|SERVICE_KEY|PRIVATE|PASSWORD|ANTHROPIC|SARVAM|DATABASE|TOKEN_ENCRYPTION/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'test-results', 'playwright-report', 'coverage']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.example', '.local', '.yml', '.yaml']);

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (EXTS.has(path.extname(e.name)) || e.name.startsWith('.env')) yield path.join(dir, e.name);
  }
}

export function scan(files, read = f => fs.readFileSync(f, 'utf8')) {
  const problems = [];
  for (const file of files) {
    const text = read(file);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const name of SECRET_NAMES) {
      const re = new RegExp(`\\b${name}\\b`);
      if (re.test(text)) problems.push(`${rel}: mentions server secret ${name}`);
    }
    for (const m of text.matchAll(/\bNEXT_PUBLIC_[A-Z0-9_]+/g))
      if (SECRETY.test(m[0])) problems.push(`${rel}: ${m[0]} looks like a secret exposed to the browser`);
  }
  return [...new Set(problems)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = [path.join(ROOT, 'apps', 'web'), path.join(ROOT, 'packages', 'shared', 'src')];
  const files = dirs.flatMap(d => [...walk(d)]);
  if (process.argv.includes('--build')) {
    // Built browser bundles: every file, whatever its extension.
    const all = function* (d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) yield* all(path.join(d, e.name));
        else yield path.join(d, e.name);
      }
    };
    files.push(...all(path.join(ROOT, 'apps', 'web', '.next', 'static')));
  }
  const problems = scan(files);
  if (problems.length) {
    console.error(`Client secret check FAILED (${problems.length}):\n${problems.map(p => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Client secret check passed (${files.length} files scanned).`);
}
