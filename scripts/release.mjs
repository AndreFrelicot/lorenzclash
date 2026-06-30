#!/usr/bin/env node
// Bump the app version in package.json, then build the release bundle (dist/).
// The version is the single source of truth — Vite bakes it into the bundle and the
// credits window displays it (see vite.config.ts → __APP_VERSION__).
//
//   pnpm release            # patch: 1.0.0 → 1.0.1
//   pnpm release minor      # minor: 1.0.0 → 1.1.0
//   pnpm release major      # major: 1.0.0 → 2.0.0
//
// No git side effects (no commit/tag) — commit the version bump yourself.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

const kind = process.argv[2] ?? 'patch';
const bumps = ['major', 'minor', 'patch'];
if (!bumps.includes(kind)) {
  console.error(`Unknown bump "${kind}". Use one of: ${bumps.join(', ')}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const parts = String(pkg.version).split('.').map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
  console.error(`package.json version "${pkg.version}" is not a clean MAJOR.MINOR.PATCH.`);
  process.exit(1);
}
const [maj, min, pat] = parts;
const next =
  kind === 'major'
    ? `${maj + 1}.0.0`
    : kind === 'minor'
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`▶ ${pkg.name} ${parts.join('.')} → ${next} — building…\n`);

// Build with the active package manager (pnpm per AGENTS.md), reading the bumped version.
execSync('pnpm build', { cwd: root, stdio: 'inherit' });
console.log(`\n✓ Released v${next} → dist/`);
