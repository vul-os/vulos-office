#!/usr/bin/env node
// site/docs/*.md are published copies of docs/*.md (plus CHANGELOG.md and
// ROADMAP.md from the repo root). They were hand-copied once and nothing kept
// them in step afterwards, so every later edit to a source silently published
// stale text — the mermaid restyle landed in docs/ARCHITECTURE.md and left
// site/docs/architecture.md rendering the old washed-out diagram.
//
// Run with --check in CI to fail on drift instead of fixing it.
//
//   node scripts/sync-site-docs.mjs          # write the copies
//   node scripts/sync-site-docs.mjs --check  # fail if any copy is stale
//
// The mapping is explicit rather than derived from a directory listing. Not
// every doc under docs/ is published (RELEASING.md, TESTING.md and the other
// contributor-facing ones are not), and a glob would quietly start publishing
// a new internal doc the moment someone added it.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = {
  'site/docs/admin-guide.md': 'docs/ADMIN-GUIDE.md',
  'site/docs/api.md': 'docs/API.md',
  'site/docs/architecture.md': 'docs/ARCHITECTURE.md',
  'site/docs/changelog.md': 'CHANGELOG.md',
  'site/docs/collaboration.md': 'docs/COLLABORATION.md',
  'site/docs/configuration.md': 'docs/CONFIGURATION.md',
  'site/docs/deploy.md': 'docs/DEPLOY.md',
  'site/docs/getting-started.md': 'docs/GETTING-STARTED.md',
  'site/docs/install.md': 'docs/INSTALL.md',
  'site/docs/roadmap.md': 'ROADMAP.md',
  'site/docs/screenshots.md': 'docs/SCREENSHOTS.md',
  'site/docs/self-hosting.md': 'docs/SELFHOST.md',
  'site/docs/threat-model.md': 'docs/THREAT-MODEL.md',
  'site/docs/troubleshooting.md': 'docs/TROUBLESHOOTING.md',
  'site/docs/user-guide.md': 'docs/USER-GUIDE.md',
};

// A published page that loses its source, or a source that loses its page, is
// the failure this exists to catch — so the count is asserted, not inferred.
const EXPECTED_PAGES = 15;

const check = process.argv.includes('--check');
let stale = 0;
let missing = 0;

if (Object.keys(PAGES).length !== EXPECTED_PAGES) {
  console.error(
    `sync-site-docs: PAGES has ${Object.keys(PAGES).length} entries, ` +
      `EXPECTED_PAGES says ${EXPECTED_PAGES}. Update both together.`,
  );
  process.exit(1);
}

for (const [dest, src] of Object.entries(PAGES)) {
  const srcPath = join(root, src);
  const destPath = join(root, dest);

  if (!existsSync(srcPath)) {
    console.error(`  ✗ ${dest}: source ${src} does not exist`);
    missing++;
    continue;
  }

  const want = readFileSync(srcPath, 'utf8');
  const have = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;

  if (have === want) continue;

  if (check) {
    console.error(`  ✗ ${dest} is stale — re-run: node scripts/sync-site-docs.mjs`);
    stale++;
  } else {
    writeFileSync(destPath, want);
    console.log(`  synced ${src} → ${dest}`);
  }
}

// The markdown was synced but the images it points at never were: site/
// screenshots/ was hand-copied once and drifted, so screenshots.md shipped two
// <img> tags that 404'd on the live docs page. Every image a published page
// references is mirrored from its source directory here, and a reference with
// no source file is a hard failure — a broken image is not something a reader
// can route around.
const IMG_RE = /!\[[^\]]*\]\((screenshots\/[^)\s]+)\)/g;
const wanted = new Map(); // 'screenshots/x.png' -> [pages that ask for it]

for (const dest of Object.keys(PAGES)) {
  const destPath = join(root, dest);
  if (!existsSync(destPath)) continue;
  const body = readFileSync(destPath, 'utf8');
  for (const m of body.matchAll(IMG_RE)) {
    if (!wanted.has(m[1])) wanted.set(m[1], []);
    wanted.get(m[1]).push(dest);
  }
}

// A reference sweep that found nothing would pass silently forever; the docs
// gallery has always carried images, so zero means the regex stopped matching.
if (wanted.size === 0) {
  console.error('sync-site-docs: found 0 image references — the scan is broken, not the docs');
  process.exit(1);
}

let imgStale = 0;
let imgMissing = 0;
mkdirSync(join(root, 'site', 'screenshots'), { recursive: true });

for (const [rel, pages] of wanted) {
  const srcPath = join(root, 'docs', rel);
  const destPath = join(root, 'site', rel);

  if (!existsSync(srcPath)) {
    console.error(`  ✗ ${rel}: referenced by ${pages.join(', ')} but docs/${rel} does not exist`);
    imgMissing++;
    continue;
  }

  const want = readFileSync(srcPath);
  const have = existsSync(destPath) ? readFileSync(destPath) : null;
  if (have && have.equals(want)) continue;

  if (check) {
    console.error(`  ✗ site/${rel} is ${have ? 'stale' : 'missing'} — re-run: node scripts/sync-site-docs.mjs`);
    imgStale++;
  } else {
    writeFileSync(destPath, want);
    console.log(`  synced docs/${rel} → site/${rel}`);
  }
}

if (missing || stale || imgStale || imgMissing) {
  console.error(
    `\nsync-site-docs: FAIL (${stale} stale, ${missing} missing source, ` +
      `${imgStale} stale image, ${imgMissing} image with no source)`,
  );
  process.exit(1);
}
console.log(
  check
    ? `sync-site-docs: all ${EXPECTED_PAGES} published pages and ${wanted.size} images match their sources`
    : `sync-site-docs: ${EXPECTED_PAGES} pages and ${wanted.size} images up to date`,
);
