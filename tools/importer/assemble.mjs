/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/* eslint-env node, es2022 */
/**
 * Page-level assembly check.
 *
 * `preview.mjs` screenshots a draft; this asserts things about it that only
 * exist once the whole page is composed:
 *
 *   - no horizontal overflow (scrollWidth === viewport width)
 *   - every block reaches data-block-status="loaded", and the count matches
 *     the component list for that page
 *   - no console errors and no failed requests, chrome included
 *   - full-page height, to diff against the captured source screenshot
 *
 * Widths are the union of the capture's (375/768/1440) and the project's own
 * CSS breakpoint (900). Those sets are disjoint, which is the point: 900 is
 * never captured and 768 is never exercised by the project's media queries.
 *
 * Assets are rewritten from their source-host URLs to the local copies under
 * drafts/assets, so the run does not depend on the source site being up. The
 * drafts keep the absolute URLs deliberately - that is how the importer finds
 * the binaries to download - so the rewrite happens here, at render time.
 *
 *   npx @adobe/aem-cli up --no-open           # in another shell
 *   PLAYWRIGHT_PATH=/tmp/eds-crawl-tools/node_modules/playwright/index.mjs \
 *     node tools/importer/assemble.mjs
 *
 * ONLY=home,policyholders limits the run. SHOTS=1 also writes screenshots.
 */
import {
  mkdir, readFile, readdir, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, '.eds-migration');
const SERVER = process.env.SERVER || 'http://localhost:3000';

/** capture widths (375/768/1440) ∪ the project's only breakpoint (900) */
const BREAKPOINTS = [375, 768, 900, 1440];
const CAPTURED = new Set([375, 768, 1440]);

/** slug in capture/ → the draft that page produced */
const PAGE_DRAFTS = {
  home: 'index',
  'node-101-newsroom-pdf-files': 'newsroom-pdf-files',
};

const head = await readFile(path.join(ROOT, 'head.html'), 'utf8');

const shell = (sections) => `<!DOCTYPE html><html lang="en"><head>
<title>assemble check</title>
${head}
</head><body><header></header><main>${sections}</main><footer></footer></body></html>`;

// ---------------------------------------------------------------- assets

const manifest = JSON.parse(
  await readFile(path.join(OUT, 'assets/manifest.json'), 'utf8'),
);

/** source URL (raw and percent-decoded) → local draft copy */
const assetMap = new Map();
for (const a of manifest) {
  const local = `/drafts/assets/${path.basename(a.target)}`;
  assetMap.set(a.source, local);
  try {
    assetMap.set(decodeURIComponent(a.source), local);
  } catch { /* malformed escape, raw form is enough */ }
}

/**
 * Points binary references at the local copies.
 * @param {string} html draft body
 * @returns {{html: string, missing: string[]}} rewritten body, unmapped URLs
 */
function localiseAssets(html) {
  let out = html;
  for (const [src, local] of assetMap) {
    out = out.split(src).join(local);
  }
  const missing = [...out.matchAll(/https?:\/\/commonwealth\.globalatlantic\.com\/[^"'\s)]+/g)]
    .map((m) => m[0]);
  return { html: out, missing: [...new Set(missing)] };
}

// ------------------------------------------------------------- expected

/**
 * The blocks a page should end up with, read from the draft itself rather
 * than assumed - a block that silently failed to render still shows up in
 * the source markup, so this is the list the loaded count is checked against.
 * @param {string} html draft body
 * @returns {string[]} block class names in source order
 */
function expectedBlocks(html) {
  return [...html.matchAll(/<div class="([^"]+)"/g)]
    .map((m) => m[1].trim())
    .filter((c) => c && !c.startsWith('section-metadata'));
}

// ------------------------------------------------------------------ run

const drafts = (await readdir(path.join(ROOT, 'drafts/imported')))
  .filter((f) => f.endsWith('.plain.html'))
  .map((f) => f.replace('.plain.html', ''));

const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const draftToSlug = new Map(Object.entries(PAGE_DRAFTS).map(([s, d]) => [d, s]));
const slugs = only.length
  ? only
  : [...new Set(drafts.map((d) => draftToSlug.get(d) || d))];

const browser = await chromium.launch();
const rows = [];

/**
 * @param {object} r one page-width result
 * @returns {boolean} true if this width failed any page-level assertion
 */
const isBad = (r) => r.overflow > 0 || r.errors.length || r.failed.length
  || r.unloaded.length || r.loaded !== r.expected || r.chrome.length !== 2
  || r.missingAssets.length;

/**
 * Renders one page at every breakpoint and asserts on it.
 * @param {string} slug capture slug
 * @param {string} raw the draft's `.plain.html` body
 */
async function checkPage(slug, raw) {
  const { html: sections, missing } = localiseAssets(raw);
  const expected = expectedBlocks(sections);
  const dir = path.join(OUT, 'pages', slug);
  if (process.env.SHOTS) await mkdir(dir, { recursive: true });

  for (const width of BREAKPOINTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const failed = [];

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.url()} (HTTP ${r.status()})`);
    });

    await page.route(`${SERVER}/assemble`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: shell(sections),
    }));

    await page.goto(`${SERVER}/assemble`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => !document.querySelector('main .section:not([data-section-status="loaded"])'),
      null,
      { timeout: 15000 },
    ).catch(() => errors.push('sections did not reach loaded status'));

    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // documentElement.scrollHeight floors at the viewport, which hides the
      // real height of short pages - body's box is the content height
      height: Math.round(document.body.getBoundingClientRect().height),
      loaded: [...document.querySelectorAll('main [data-block-status="loaded"]')]
        .map((b) => b.dataset.blockName),
      // chrome loads through loadHeader/loadFooter, not the section path
      chrome: ['header', 'footer'].filter((t) => document
        .querySelector(`${t} .${t}[data-block-status="loaded"]`)),
      unloaded: [...document.querySelectorAll('[data-block-status]:not([data-block-status="loaded"])')]
        .map((b) => `${b.dataset.blockName}=${b.dataset.blockStatus}`),
      // widest element that pokes past the viewport, to name the culprit
      overflowing: (() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main *, header *, footer *')]
          .filter((el) => el.getBoundingClientRect().right > vw + 1)
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
      })(),
    }));

    if (process.env.SHOTS) {
      await page.screenshot({ path: path.join(dir, `assembled-${width}.png`), fullPage: true });
    }

    rows.push({
      slug,
      width,
      captured: CAPTURED.has(width),
      overflow: m.scrollWidth - m.clientWidth,
      overflowing: m.overflowing,
      height: m.height,
      expected: expected.length,
      loaded: m.loaded.length,
      chrome: m.chrome,
      unloaded: m.unloaded,
      missingAssets: missing,
      errors: [...new Set(errors)],
      failed: [...new Set(failed)],
    });
    await page.close();
  }

  const mine = rows.filter((r) => r.slug === slug);
  const bad = mine.filter(isBad);
  const flag = bad.length ? 'FAIL' : 'ok  ';
  const detail = bad.length
    ? bad.map((r) => `${r.width}:${[
      r.overflow > 0 ? `overflow+${r.overflow}${r.overflowing.length ? ` (${r.overflowing[0]})` : ''}` : '',
      r.loaded !== r.expected ? `blocks ${r.loaded}/${r.expected}` : '',
      r.chrome.length !== 2 ? `chrome ${r.chrome.join('+') || 'none'}` : '',
      r.unloaded.length ? `unloaded ${r.unloaded.join(',')}` : '',
      r.missingAssets.length ? `${r.missingAssets.length} unmapped asset` : '',
      r.failed.length ? `${r.failed.length} failed req` : '',
      r.errors.length ? `${r.errors.length} err` : '',
    ].filter(Boolean).join(' ')}`).join(' | ')
    : `${mine[0].expected} blocks · h=${mine.map((r) => r.height).join('/')}`;
  console.log(`${flag} ${slug.padEnd(46)} ${detail}`);
}

for (const slug of slugs) {
  const draft = PAGE_DRAFTS[slug] || slug;
  const raw = await readFile(path.join(ROOT, 'drafts/imported', `${draft}.plain.html`), 'utf8')
    .catch(() => null);
  if (raw === null) console.log(`SKIP ${slug} (no draft ${draft}.plain.html)`);
  else await checkPage(slug, raw);
}

await browser.close();
await writeFile(path.join(OUT, 'assemble.json'), `${JSON.stringify(rows, null, 2)}\n`);

const fails = rows.filter(isBad);
console.log(`\n${rows.length} page-widths · ${fails.length} failing · → .eds-migration/assemble.json`);
