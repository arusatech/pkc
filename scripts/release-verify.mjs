#!/usr/bin/env node
/**
 * Preflight before electron-builder packaging.
 * Ensures llama-cpp-pro desktop sidecar binaries are staged for the target OS.
 *
 * Usage:
 *   node scripts/release-verify.mjs mac
 *   node scripts/release-verify.mjs win
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = (process.argv[2] || '').toLowerCase();
if (target !== 'mac' && target !== 'win') {
  console.error('Usage: node scripts/release-verify.mjs <mac|win>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let llamaRoot;
try {
  llamaRoot = dirname(require.resolve('llama-cpp-pro/package.json'));
} catch {
  llamaRoot = join(root, '..', 'llama-cpp-pro');
}

const verifyScript = join(llamaRoot, 'scripts', 'ensure-desktop-sidecar-bundle.cjs');
if (!existsSync(verifyScript)) {
  console.error(`Missing verify script: ${verifyScript}`);
  process.exit(1);
}

const args =
  target === 'mac'
    ? [verifyScript, '--platform=darwin', '--arch=universal']
    : [verifyScript, '--platform=win32'];

console.log(`Verifying llama-cpp-pro desktop bundle for ${target}…`);
console.log(`  llama root: ${llamaRoot}`);

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('\nRelease preflight failed.');
  if (target === 'mac') {
    console.error('From llama-cpp-pro: npm run build:sidecar:universal && npm run stage:desktop');
  } else {
    console.error('From llama-cpp-pro (on Windows): npm run build:sidecar:win && npm run stage:desktop');
    console.error('Then re-run this verify, then npm run electron:make:win');
  }
  process.exit(result.status ?? 1);
}

console.log('Release preflight OK.');
