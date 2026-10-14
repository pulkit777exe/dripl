#!/usr/bin/env node
/**
 * Generate a CycloneDX-ish software bill of materials (SBOM), stdlib only.
 *
 * Usage:
 *   pnpm list --prod --json | node scripts/sbom.mjs --output sbom.json
 *   node scripts/sbom.mjs --output sbom.json [--input <file>]
 *
 * The preferred pipe is `pnpm list --prod --json`, which enumerates the
 * production tree once dependencies are installed. That command only lists
 * workspace roots when node_modules is absent, so when the piped input yields
 * zero components this script falls back to `pnpm licenses list --prod --json`
 * (lockfile-based, works without an install — it is also the source behind the
 * inventory snapshot in docs/dependencies.md). Both input shapes are accepted
 * on stdin or via --input.
 *
 * Output shape (deliberately minimal):
 *   { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
 *     metadata: { timestamp, component: { name, version } },
 *     components: [{ name, version, purl }] }
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage:',
    '  pnpm list --prod --json | node scripts/sbom.mjs --output sbom.json',
    '  node scripts/sbom.mjs --output sbom.json [--input <file>]',
  ].join('\n');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

const outputPath = flagValue('--output');
const inputPath = flagValue('--input');

function readStdin() {
  // No pipe: stdin is a TTY (or closed). Treat as "no input", not a block.
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function collectFromPnpmListTree(node, into) {
  // `pnpm list --json`: array of projects, each with nested
  // { dependencies: { <name>: { version, dependencies? } } } maps.
  if (Array.isArray(node)) {
    for (const entry of node) collectFromPnpmListTree(entry, into);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const group = node[key];
    if (!group || typeof group !== 'object') continue;
    if (Array.isArray(group)) {
      for (const dep of group) {
        if (dep && typeof dep === 'object' && dep.name && dep.version) {
          into.push({ name: String(dep.name), version: String(dep.version) });
          collectFromPnpmListTree(dep, into);
        }
      }
    } else {
      for (const [name, dep] of Object.entries(group)) {
        if (dep && typeof dep === 'object' && dep.version) {
          into.push({ name, version: String(dep.version) });
          collectFromPnpmListTree(dep, into);
        }
      }
    }
  }
}

function collectFromLicensesMap(node, into) {
  // `pnpm licenses list --json`: { <license>: [{ name, versions: [] }] }.
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  let seen = false;
  for (const entries of Object.values(node)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || !entry.name) continue;
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      if (versions.length === 0 && entry.version) versions.push(entry.version);
      for (const version of versions) {
        into.push({ name: String(entry.name), version: String(version) });
        seen = true;
      }
    }
  }
  return seen;
}

function collectComponents(parsed) {
  const found = [];
  if (Array.isArray(parsed)) {
    collectFromPnpmListTree(parsed, found);
  } else if (!collectFromLicensesMap(parsed, found)) {
    collectFromPnpmListTree(parsed, found);
  }
  return found;
}

function licensesFallback() {
  const raw = execSync('pnpm licenses list --prod --json', {
    encoding: 'utf8',
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return collectComponents(JSON.parse(raw));
}

let rawInput = '';
if (inputPath) {
  rawInput = readFileSync(resolve(repoRoot, inputPath), 'utf8');
} else {
  rawInput = readStdin().trim();
}

let found = [];
if (rawInput) {
  if (inputPath) {
    found = collectComponents(JSON.parse(rawInput));
  } else {
    try {
      found = collectComponents(JSON.parse(rawInput));
    } catch {
      // A truncated pipe (e.g. `pnpm list` dying mid-write) is not a
      // well-formed inventory; fall through to the lockfile fallback below
      // instead of crashing on a partial document.
      console.error(
        'sbom: piped input is not valid JSON, falling back to `pnpm licenses list --prod --json`'
      );
      found = [];
    }
  }
}

if (found.length === 0 && !inputPath) {
  // `pnpm list` without an install only yields workspace roots (no versions
  // to record). Fall back to the lockfile-based license inventory instead of
  // emitting an empty SBOM.
  console.error(
    'sbom: piped input yielded no components, falling back to `pnpm licenses list --prod --json`'
  );
  try {
    found = licensesFallback();
  } catch (error) {
    console.error(`sbom: fallback failed (${error.message.split('\n')[0]}); is pnpm on PATH?`);
    process.exit(1);
  }
}

if (found.length === 0) {
  console.error('sbom: no production components found; refusing to emit an empty SBOM');
  process.exit(1);
}

const deduped = [...new Map(found.map(d => [`${d.name}@${d.version}`, d])).values()].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1
);

let rootName = 'dripl';
let rootVersion = '0.0.0';
try {
  const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  if (rootPkg.name) rootName = String(rootPkg.name);
  if (rootPkg.version) rootVersion = String(rootPkg.version);
} catch {
  // Keep defaults; the SBOM must not fail because the manifest is unreadable.
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { name: rootName, version: rootVersion },
  },
  components: deduped.map(d => ({
    name: d.name,
    version: d.version,
    purl: `pkg:npm/${encodeURIComponent(d.name)}@${encodeURIComponent(d.version)}`,
  })),
};

const text = `${JSON.stringify(bom, null, 2)}\n`;
if (outputPath) {
  const resolved = resolve(repoRoot, outputPath);
  writeFileSync(resolved, text);
  console.error(`sbom: ${bom.components.length} components -> ${resolved}`);
} else {
  process.stdout.write(text);
}
