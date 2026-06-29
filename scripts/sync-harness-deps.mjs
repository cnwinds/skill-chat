#!/usr/bin/env node
/**
 * Switch @harnesskit/* dependencies between local file: links and npm registry versions.
 *
 * Usage:
 *   node scripts/sync-harness-deps.mjs local
 *   node scripts/sync-harness-deps.mjs registry [--version=0.1.0]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const manifestPath = path.join(repoRoot, 'config/harness-deps.manifest.json');

const mode = process.argv[2];
const versionFlag = process.argv.find((arg) => arg.startsWith('--version='));
const versionOverride = versionFlag?.slice('--version='.length);

if (mode !== 'local' && mode !== 'registry') {
  console.error('Usage: node scripts/sync-harness-deps.mjs <local|registry> [--version=0.1.0]');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const registryVersion = versionOverride ?? manifest.registryVersion;

if (!registryVersion) {
  console.error('registryVersion is required in config/harness-deps.manifest.json or via --version=');
  process.exit(1);
}

const resolveRegistrySpec = (name) => `^${registryVersion}`;

const dependencyMap = mode === 'local'
  ? manifest.local
  : Object.fromEntries(
      Object.keys(manifest.local).map((name) => [name, resolveRegistrySpec(name)]),
    );

let changedFiles = 0;

for (const [relativePath, packageNames] of Object.entries(manifest.targets)) {
  const packageJsonPath = path.join(repoRoot, relativePath);
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  let changed = false;

  for (const name of packageNames) {
    const nextValue = dependencyMap[name];
    if (!nextValue) {
      console.error(`Missing dependency mapping for ${name}`);
      process.exit(1);
    }
    if (pkg.dependencies?.[name] !== nextValue) {
      pkg.dependencies[name] = nextValue;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    changedFiles += 1;
    console.log(`updated ${relativePath}`);
  } else {
    console.log(`unchanged ${relativePath}`);
  }
}

if (mode === 'registry') {
  console.log(`\n@harnesskit/* now point to npm ^${registryVersion}`);
  console.log('Run: npm install');
  console.log('Docker: set HARNESSKIT_VERSION in docker/.env before compose build');
} else {
  console.log('\n@harnesskit/* now point to local harness-kit file: links');
  console.log('Ensure ../harness-kit exists, then run: npm run build:harness-kit && npm install');
}

if (changedFiles === 0) {
  console.log('\nNo package.json changes were needed.');
}
