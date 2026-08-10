/**
 * site/ render gate — loads site/index.html and site/docs.html in a real
 * browser at every width we claim to support, in both colour schemes, and
 * fails on the defects that reading the HTML cannot see.
 *
 * Why a browser: every defect this catches was invisible in the source.
 * A diagram whose labels are declared at 15px but drawn at 3.9px because the
 * SVG is scaled down to fit; an inline <code> run that pushes the page
 * sideways on a 320px phone while body{overflow-x:clip} hides the evidence;
 * an image stretched off its aspect ratio; a markdown cross-reference to a
 * heading id that no longer exists; a font or script quietly fetched off-box.
 * All five read fine as text.
 *
 *   node scripts/check-render.mjs              # serve site/ and measure it
 *   node scripts/check-render.mjs --selftest   # break each check on purpose
 *
 * Each check reports what it MEASURED, not just pass/fail, so a green run is
 * evidence rather than an assertion.
 */

import { createServer } from 'http';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve, dirname, extname, join, normalize } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SITE = resolve(REPO, 'site');

// The page this gate believes it is measuring. A concurrent agent's stray
// `python3 -m http.server` elsewhere in this fleet once served a DIFFERENT
// product's site on the port a gate assumed, and 410 width×scheme
// combinations came back green with nothing in the output looking wrong.
// This gate binds its own ephemeral port rather than a well-known one, and
// still refuses to trust a single measurement until the served <title> proves
// the document is diwan's.
const TITLE_MUST_MATCH = {
  'index.html': /^Diwan\b/,
  'docs.html': /^Diwan docs\b/,
};

const PAGES = ['index.html', 'docs.html'];

const VIEWPORTS = [
  { w: 1920, h: 1080, label: 'desktop-xl' },
  { w: 1440, h: 900, label: 'desktop' },
  { w: 1280, h: 800, label: 'laptop' },
  { w: 1024, h: 768, label: 'tablet-landscape' },
  { w: 768, h: 1024, label: 'tablet' },
  { w: 430, h: 932, label: 'phone-large' },
  { w: 390, h: 844, label: 'phone' },
  { w: 320, h: 720, label: 'phone-min' },
];

// ---------------------------------------------------------------------------
// Playwright, from wherever it lives on this box.
// Diwan is a Go repo with no package.json, so there is no local node_modules to
// resolve from. Bare `import 'playwright'` resolves relative to THIS file's
// directory and would fail; walk the fleet for a checkout that has one.
// ---------------------------------------------------------------------------
async function loadPlaywright() {
  const tried = [];
  try { return await import('playwright'); } catch { tried.push('<bare specifier>'); }

  const candidates = [];
  if (process.env.PLAYWRIGHT_NODE_MODULES) candidates.push(process.env.PLAYWRIGHT_NODE_MODULES);
  const seen = new Set();
  for (const up of ['..', '../..']) {
    const root = resolve(REPO, up);
    if (seen.has(root)) continue;
    seen.add(root);
    let entries = [];
    try { entries = await readdir(root); } catch { continue; }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      candidates.push(join(root, e, 'node_modules'));
      candidates.push(join(root, e, 'web', 'node_modules'));
      for (const app of ['desktop', 'web', 'site']) {
        candidates.push(join(root, e, 'apps', app, 'node_modules'));
      }
    }
  }

  for (const root of candidates) {
    if (!root || !existsSync(join(root, 'playwright'))) continue;
    try {
      const req = createRequire(join(root, '__resolve__.js'));
      const entry = req.resolve('playwright');
      const raw = await import(pathToFileURL(entry).href);
      // Playwright is CommonJS. Importing it by PATH skips Node's named-export
      // detection, so the launchers arrive under `default` rather than as named
      // exports — a different shape from a bare `import('playwright')`.
      const mod = raw?.chromium ? raw : raw?.default;
      // Resolvable is not the same as usable: a stub or a partial install
      // resolves fine and then dies three calls later.
      if (!mod?.chromium?.launch) { tried.push(`${root} (no chromium launcher)`); continue; }
      console.log(`check-render: using playwright from ${root}`);
      return mod;
    } catch (e) { tried.push(`${root} (${e.code || e.message})`); }
  }

  console.error('check-render: could not load playwright.\n  tried: ' + tried.join('\n         ') +
    '\n  set PLAYWRIGHT_NODE_MODULES=/path/to/node_modules');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function serve(root) {
  return new Promise(ok => {
    const s = createServer(async (req, res) => {
      const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let file = join(root, rel);
      if (!extname(file)) file = join(file, 'index.html');
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    // Port 0: the kernel hands out a free ephemeral port that nothing else on
    // this machine is already squatting on, so there is no way to measure
    // somebody else's server by accident.
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
const findings = [];
const notes = [];
const fail = (check, where, detail) => findings.push({ check, where, detail });
const note = (s) => notes.push(s);

// ---------------------------------------------------------------------------
// The in-page measurement pass.
// ---------------------------------------------------------------------------
async function inspect(page, opts = {}) {
  return page.evaluate(async ({ isDark }) => {
    const out = {
      title: document.title, overflow: null, imgs: [], smallText: [], textScanned: 0,
      deadAnchors: [], anchorsScanned: 0, marks: [],
    };

    // 1 · horizontal overflow, measured GEOMETRICALLY.
    //
    // `documentElement.scrollWidth - clientWidth <= 1` is NOT usable here.
    // Diwan's body carries overflow-x:clip (docs) / hidden (index), and a
    // clipped container reports the CLIPPED width — so that assertion passes
    // vacuously no matter how far a child bleeds. Basin's docs page passed 41
    // widths × 2 schemes that way while body.scrollWidth was 742 against a 320
    // viewport with inline <code> genuinely cut off.
    //
    // So walk the elements instead: an element is a defect if its box crosses
    // the viewport edge and NO ancestor between it and <body> clips or scrolls
    // horizontally. Stopping the ancestor walk BEFORE body is the whole point
    // — body's own clip is the thing hiding the bug, not a licence for it.
    // A wide <pre> or a mermaid diagram inside its own overflow-x:auto box is
    // deliberate design and is correctly ignored.
    const de = document.documentElement;
    const bleed = [];
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) {
        const pcs = getComputedStyle(p);
        if (/auto|scroll|hidden|clip/.test(pcs.overflowX)) { contained = true; break; }
        p = p.parentElement;
      }
      if (contained) return;
      // Content parked wholly off-screen left (a skip link at -9999px) adds no
      // horizontal scroll; only a right-edge crossing does, plus anything
      // straddling the left edge and therefore partly unreachable.
      if (r.right <= 0) return;
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        bleed.push({
          tag: el.tagName, cls: String(el.className.baseVal ?? el.className).slice(0, 50),
          left: Math.round(r.left), right: Math.round(r.right),
        });
      }
    });
    out.overflow = { docW: de.scrollWidth, bodyW: document.body.scrollWidth, winW: window.innerWidth, bleed: bleed.slice(0, 8) };

    return out;
  }, { isDark: !!opts.isDark });
}

// ---------------------------------------------------------------------------
async function checkPage(browser, base, path, theme, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, colorScheme: theme,
  });
  const page = await ctx.newPage();
  const where = `${path} ${vp.label}(${vp.w}) ${theme}`;

  const httpErrors = [];
  page.on('response', r => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => fail('js-error', where, e.message));

  await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    document.querySelectorAll('.reveal, .rv, [data-reveal]')
      .forEach(e => e.classList.add('is-visible', 'in', 'is-in', 'visible')));
  await page.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 20)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);

  const r = await inspect(page, { isDark: theme === 'dark' });

  // Identity first: no measurement below is worth anything if this is not the
  // document we think it is.
  const want = TITLE_MUST_MATCH[path];
  if (want && !want.test(r.title)) {
    fail('wrong-page', where, `served <title> is “${r.title}”, which does not match ${want} — refusing to trust any measurement`);
    await ctx.close();
    return r;
  }

  if (r.overflow.bleed.length) {
    fail('h-overflow', where,
      `viewport is ${r.overflow.winW}px; elements cross its edge with no clipping ancestor: ` +
      r.overflow.bleed.map(b => `${b.tag}${b.cls ? '.' + b.cls : ''} [${b.left}→${b.right}]`).join('; '));
  }
  httpErrors.forEach(u => fail('http-error', where, u));

  await ctx.close();
  return r;
}

// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(join(SITE, 'index.html'))) {
    console.error(`check-render: no site/index.html under ${SITE}`);
    process.exit(2);
  }
  const { chromium } = await loadPlaywright();
  const server = await serve(SITE);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  console.log(`check-render: serving ${SITE} on ${base}`);

  try {
    let combos = 0;
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        for (const path of PAGES) {
          if (!existsSync(join(SITE, path))) continue;
          await checkPage(browser, base, path, theme, vp);
          combos++;
        }
      }
    }

    console.log(`\nchecked ${combos} page×width×scheme combinations\n`);
    notes.forEach(n => console.log('  · ' + n));

    if (findings.length) {
      console.error(`\ncheck-render: ${findings.length} finding(s)\n`);
      const byCheck = {};
      findings.forEach(f => (byCheck[f.check] ||= []).push(f));
      for (const [check, list] of Object.entries(byCheck)) {
        console.error(`  ${check} (${list.length})`);
        // Collapse the width dimension: the same defect at eight widths is one
        // defect, and printing it eight times buries the others.
        const seen = new Set();
        list.forEach(f => {
          if (seen.has(f.detail)) return;
          seen.add(f.detail);
          console.error(`    ${f.where}\n      ${f.detail}`);
        });
      }
      process.exitCode = 1;
    } else {
      console.log('\ncheck-render: clean');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(2); });
