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

// docs.html is a hash router: one shell that fetches site/docs/<slug>.md into
// #content. Measuring `docs.html` alone therefore measures exactly ONE of the
// fifteen chapters, and the other fourteen would ride along untested. The full
// width×scheme matrix runs against these three routes — the landing, the
// default chapter, and the chapter with the widest tables and both mermaid
// diagrams — and a separate narrow/wide sweep covers every remaining chapter.
const MATRIX_TARGETS = ['index.html', 'docs.html', 'docs.html#architecture'];

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

    // 2 · EFFECTIVE text size, i.e. after every transform between the glyph and
    // the screen — not the declared font-size property.
    //
    // This is the check that would have caught the mermaid regression. The
    // config declared themeVariables.fontSize:'15px' and a gate reading the
    // declared value would have passed, while useMaxWidth:true was fitting a
    // 925px drawing into the prose column and scaling the whole SVG — labels
    // included — down to 11.5px at 1440 and 3.9px at 320. Twice reported by
    // eye, never by a check.
    //
    // Two mechanisms scale text and neither shows up in font-size:
    //   · CSS transform / zoom on any ancestor;
    //   · an <svg> viewBox mapping user units onto a smaller CSS box.
    // getComputedStyle on an SVG element reports NOMINAL user units, so the
    // second is invisible to it entirely. getScreenCTM is the honest answer,
    // and it already composes ancestor CSS transforms (measured: a viewBox
    // halving inside a scale(0.5) wrapper reports 0.25), so inside an <svg> it
    // is the authority and must not be multiplied by them again.
    const effectiveScale = (el) => {
      const svgHost = el.ownerSVGElement
        || (el.tagName === 'svg' ? el : null)
        || (el.closest ? el.closest('foreignObject') : null);
      if (svgHost && svgHost.getScreenCTM) {
        const m = svgHost.getScreenCTM();
        if (m) return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      }
      let s = 1;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.transform && cs.transform !== 'none') {
          const m = new DOMMatrixReadOnly(cs.transform);
          s *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
        }
        const z = parseFloat(cs.zoom);
        if (z && z !== 1 && !Number.isNaN(z)) s *= z;
      }
      return s;
    };

    const FLOOR = 12;
    const TEXTY = new Set(['P', 'LI', 'DD', 'DT', 'TD', 'TH', 'SPAN', 'B', 'I', 'EM', 'STRONG',
      'A', 'CODE', 'FIGCAPTION', 'LABEL', 'SMALL', 'BLOCKQUOTE', 'BUTTON', 'DIV',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'text', 'tspan']);
    // `body *`, not `main *`: elsewhere in this fleet a page with no <main>
    // made the equivalent scan match almost nothing, so the floor passed
    // vacuously and a planted 9px paragraph went straight through a self-test.
    document.querySelectorAll('body *').forEach(el => {
      const tag = el.tagName;
      if (!TEXTY.has(tag) && !TEXTY.has(String(tag).toLowerCase())) return;
      // Only elements holding their OWN text, so a wrapper is not blamed for a
      // child's size and one string is not counted twice.
      const own = [...el.childNodes]
        .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (own.length < 2) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (parseFloat(cs.opacity) === 0) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      out.textScanned++;
      const declared = parseFloat(cs.fontSize);
      const scale = effectiveScale(el);
      const effective = +(declared * scale).toFixed(2);
      if (effective < FLOOR) {
        out.smallText.push({
          tag: String(tag).toLowerCase(), declared, scale: +scale.toFixed(3), effective,
          text: own.slice(0, 40),
        });
      }
    });

    // 3 · rendered aspect ratio vs the source's true aspect ratio.
    // naturalWidth is DENSITY-CORRECTED: a candidate chosen through a "2x"
    // descriptor reports half its real pixel width, so re-load currentSrc bare
    // to learn the file's actual size before judging sharpness.
    const trueSize = async (url) => await new Promise(res => {
      const probe = new Image();
      probe.onload = () => res([probe.naturalWidth, probe.naturalHeight]);
      probe.onerror = () => res([0, 0]);
      probe.src = url;
    });
    for (const im of document.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (!im.naturalWidth || !im.naturalHeight) continue;
      const url = im.currentSrc || im.src;
      const [px, py] = await trueSize(url);
      // Only object-fit:fill (the default) stretches pixels. cover/contain/none
      // crop or letterbox, so a box ratio unlike the source ratio is intended.
      const fit = getComputedStyle(im).objectFit;
      out.imgs.push({
        file: url.split('/').pop(),
        css: `${Math.round(r.width)}x${Math.round(r.height)}`,
        nat: `${im.naturalWidth}x${im.naturalHeight}`,
        realPx: `${px}x${py}`,
        skewPct: fit === 'fill'
          ? +(Math.abs((r.width / r.height) / (im.naturalWidth / im.naturalHeight) - 1) * 100).toFixed(1)
          : 0,
        offersSrcset: !!(im.srcset || im.closest('picture')?.querySelector('source[srcset]')),
        upscale: px ? +(r.width * devicePixelRatio / px).toFixed(2) : 0,
      });
    }

    // 4 · same-page fragment links resolve.
    // docs.html is a hash ROUTER, so `#architecture` is a route, not an id, and
    // must be judged against the chapter list. The on-this-page TOC uses
    // href="#" with a data-id instead; that id has to exist too.
    const routes = new Set([...document.querySelectorAll('[data-slug]')].map(e => e.dataset.slug));
    document.querySelectorAll('a[href^="#"], a[data-id]').forEach(a => {
      const raw = a.getAttribute('href') || '';
      const id = a.dataset.id || raw.slice(1);
      if (!id) return;
      out.anchorsScanned++;
      if (routes.has(id)) return;
      if (document.getElementById(id)) return;
      if (document.querySelector(`[name="${CSS.escape(id)}"]`)) return;
      out.deadAnchors.push({ href: '#' + id, text: a.textContent.trim().slice(0, 30) });
    });

    // 5 · the docs shell fetches its prose at runtime. If that fetch fails the
    // page still renders — header, rail, footer, all of it — and every other
    // measurement above passes over an empty column. Refuse to call a chapter
    // measured unless its prose is actually there.
    const content = document.getElementById('content');
    if (content) {
      out.chapter = {
        chars: content.textContent.trim().length,
        headings: content.querySelectorAll('h1,h2,h3').length,
        error: !!content.querySelector('.docs-error'),
        unpaintedMermaid: content.querySelectorAll('code.language-mermaid').length,
        mermaidSvgs: content.querySelectorAll('.mermaid svg').length,
      };
    }

    // 6 · the docs rail stays pinned. Commit 51549cf blamed overflow-x:hidden
    // for unpinning it; that rationale is wrong (mutating it back to hidden
    // leaves the rail pinned). What actually governs pinning is position:sticky
    // on .docs-rail — mutate that to static and the rail lands at -2897. So
    // measure the behaviour, not the property that was blamed for it.
    const rail = document.querySelector('.docs-rail');
    if (rail && rail.getBoundingClientRect().height > 4) {
      const before = window.scrollY;
      window.scrollTo(0, document.body.scrollHeight);
      const top = rail.getBoundingClientRect().top;
      out.rail = { position: getComputedStyle(rail).position, topAfterScroll: Math.round(top), winH: window.innerHeight };
      window.scrollTo(0, before);
    }

    return out;
  }, { isDark: !!opts.isDark });
}

// ---------------------------------------------------------------------------
async function checkPage(browser, base, target, theme, vp) {
  const path = target.split('#')[0];
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, colorScheme: theme,
  });
  const page = await ctx.newPage();
  const where = `${target} ${vp.label}(${vp.w}) ${theme}`;

  const httpErrors = [];
  page.on('response', r => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => fail('js-error', where, e.message));

  // Every subresource must come from the page's own origin. The site claims to
  // be self-contained and air-gappable — mermaid, marked and highlight.js are
  // vendored under site/assets/vendor/ precisely so it is true — and nothing
  // was enforcing it. A <script src="https://cdn…"> or a Google Fonts @import
  // is exactly the kind of thing that arrives in a hurry and then stays.
  const offOrigin = new Set();
  page.on('request', r => {
    const url = r.url();
    if (r.resourceType() === 'document') return;
    if (/^(data|blob|about|javascript):/.test(url)) return;
    if (url.startsWith(base)) return;
    offOrigin.add(`${r.resourceType()} ${url}`);
  });

  await page.goto(`${base}/${target}`, { waitUntil: 'networkidle' });
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

  // A scan that matched nothing proves nothing. Say so loudly rather than
  // reporting the resulting silence as a pass.
  if (r.textScanned < 10) {
    fail('vacuous-scan', where, `only ${r.textScanned} text-bearing elements found — the legibility floor had nothing to measure`);
  }

  r.smallText.forEach(t => fail('text-too-small', where,
    t.scale === 1
      ? `<${t.tag}> at ${t.effective}px: “${t.text}”`
      : `<${t.tag}> declared ${t.declared}px but drawn at ${t.effective}px (scaled ${t.scale}×): “${t.text}”`));

  r.imgs.forEach(i => {
    if (i.skewPct > 1.5) {
      fail('img-distorted', where,
        `${i.file} drawn ${i.css} from a ${i.nat} source — ${i.skewPct}% off its true aspect ratio`);
    }
    // Vector art has no resolution to fall short of.
    const isVector = /\.svgx?(\?|#|$)/i.test(i.file);
    if (!isVector && i.offersSrcset && i.upscale > 1.15) {
      fail('img-soft', where, `${i.file} drawn ${i.css} at dpr2 from a ${i.realPx} file — upscaled ${i.upscale}×`);
    }
  });

  r.deadAnchors.forEach(a =>
    fail('dead-anchor', where, `${a.href} (“${a.text}”) matches no id, [name] or chapter route on the page`));

  if (r.chapter) {
    if (r.chapter.error) fail('chapter-not-loaded', where, 'the chapter body rendered a .docs-error placeholder');
    else if (r.chapter.chars < 400 || r.chapter.headings === 0) {
      fail('chapter-not-loaded', where,
        `chapter body holds ${r.chapter.chars} chars and ${r.chapter.headings} headings — the prose did not load, so nothing else here was really measured`);
    }
    if (r.chapter.unpaintedMermaid > 0) {
      fail('mermaid-unpainted', where, `${r.chapter.unpaintedMermaid} mermaid block(s) still raw <code>; the renderer did not run`);
    }
  }

  if (r.rail) {
    if (r.rail.position !== 'sticky') {
      fail('rail-unpinned', where, `.docs-rail computes position:${r.rail.position}; pinning depends on position:sticky`);
    } else if (r.rail.topAfterScroll < -1 || r.rail.topAfterScroll > r.rail.winH) {
      fail('rail-unpinned', where,
        `.docs-rail sits at top ${r.rail.topAfterScroll} in a ${r.rail.winH}px viewport after scrolling to the bottom — it scrolled away instead of pinning`);
    }
  }

  httpErrors.forEach(u => fail('http-error', where, u));
  offOrigin.forEach(u => fail('off-origin', where,
    `${u} — the site must be self-contained; vendor it under site/assets/vendor/`));

  await ctx.close();
  return r;
}

// ---------------------------------------------------------------------------
// Cross-page fragment links: index.html ↔ docs.html, including the routes.
// ---------------------------------------------------------------------------
async function checkCrossPageAnchors(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const idsOf = async (p) => {
    await page.goto(`${base}/${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    return page.evaluate(() => ({
      ids: [...document.querySelectorAll('[id]')].map(e => e.id),
      routes: [...document.querySelectorAll('[data-slug]')].map(e => e.dataset.slug),
    }));
  };
  const linksOf = async (p) => {
    await page.goto(`${base}/${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    return page.evaluate(() => [...document.querySelectorAll('a[href*=".html#"]')]
      .map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 30) })));
  };

  const known = {};
  for (const p of PAGES) {
    const { ids, routes } = await idsOf(p);
    known[p] = new Set([...ids, ...routes]);
    note(`${p}: ${ids.length} addressable ids + ${routes.length} chapter routes`);
  }
  for (const from of PAGES) {
    for (const l of await linksOf(from)) {
      const [file, frag] = l.href.replace(/^\.\//, '').split('#');
      if (!known[file]) continue;                       // external or unknown target
      if (!known[file].has(frag)) {
        fail('dead-anchor', `${from} → ${l.href}`,
          `“${l.text}” points at #${frag}, which ${file} defines as neither an id nor a route`);
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Every remaining chapter, at the two widths where the defects live: 320,
// where prose and tables bleed, and 1440, where the diagrams are drawn.
// ---------------------------------------------------------------------------
async function checkAllChapters(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/docs.html`, { waitUntil: 'networkidle' });
  const slugs = await page.evaluate(() => [...document.querySelectorAll('[data-slug]')].map(e => e.dataset.slug));
  await ctx.close();

  for (const slug of slugs) {
    for (const vp of [{ w: 320, h: 720, label: 'phone-min' }, { w: 1440, h: 900, label: 'desktop' }]) {
      const already = MATRIX_TARGETS.includes(`docs.html#${slug}`);
      if (already) continue;
      await checkPage(browser, base, `docs.html#${slug}`, 'dark', vp);
    }
  }
  note(`swept ${slugs.length} docs chapters at 320 and 1440`);
  return slugs.length;
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
    let combos = 0, imgs = 0, texts = 0, anchors = 0;
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        for (const target of MATRIX_TARGETS) {
          if (!existsSync(join(SITE, target.split('#')[0]))) continue;
          const r = await checkPage(browser, base, target, theme, vp);
          combos++; imgs += r.imgs.length; texts += r.textScanned; anchors += r.anchorsScanned;
        }
      }
    }
    const chapters = await checkAllChapters(browser, base);
    await checkCrossPageAnchors(browser, base);

    console.log(`\nchecked ${combos} route×width×scheme combinations plus ${chapters} chapters at 2 widths\n` +
      `  ${texts} text runs measured for effective size, ${imgs} rendered images, ${anchors} fragment links\n`);
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
