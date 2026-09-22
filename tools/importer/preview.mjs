/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/* eslint-env node, es2022 */
/**
 * Renders the imported drafts through the real EDS runtime and screenshots
 * them, so the transform can be compared against the source capture.
 *
 * The aem-cli version in use has no `--html-folder`, so the pages are served
 * by intercepting a route and returning an EDS page shell (head.html verbatim
 * + the draft's sections in `<main>`). Everything else — aem.js, scripts.js,
 * the block JS and CSS — is fetched from the dev server, so what is rendered
 * is the genuine decorated output, not an approximation.
 *
 *   npx @adobe/aem-cli up --no-open          # in another shell
 *   PLAYWRIGHT_PATH=/tmp/eds-crawl-tools/node_modules/playwright/index.mjs \
 *     node tools/importer/preview.mjs
 *
 * ONLY=home,policyholders limits the run. Screenshots land beside the source
 * ones in .eds-migration/pages/<slug>/target-<width>.png.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, '.eds-migration');
const SERVER = process.env.SERVER || 'http://localhost:3000';
const BREAKPOINTS = [375, 1440];

/** slug in capture/ → the draft that page produced */
const PAGE_DRAFTS = {
  home: 'index',
  'node-101-newsroom-pdf-files': 'newsroom-pdf-files',
};

const head = await readFile(path.join(ROOT, 'head.html'), 'utf8');

/**
 * @param {string} sections `.plain.html` body
 * @returns {string} a full EDS page
 */
const shell = (sections) => `<!DOCTYPE html><html lang="en"><head>
<title>import preview</title>
${head}
</head><body><header></header><main>${sections}</main><footer></footer></body></html>`;

const drafts = (await readdir(path.join(ROOT, 'drafts/imported')))
  .filter((f) => f.endsWith('.plain.html'))
  .map((f) => f.replace('.plain.html', ''));

const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const slugs = only.length ? only : Object.keys(PAGE_DRAFTS).concat(drafts);

const browser = await chromium.launch();
const results = [];

/**
 * Renders one draft at each breakpoint and screenshots it.
 * @param {string} slug capture slug, used for the output directory
 * @param {string} sections the draft's `.plain.html` body
 */
async function renderPage(slug, sections) {
  const dir = path.join(OUT, 'pages', slug);
  await mkdir(dir, { recursive: true });

  for (const width of BREAKPOINTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route(`${SERVER}/preview`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: shell(sections),
    }));

    await page.goto(`${SERVER}/preview`, { waitUntil: 'networkidle' });
    // scripts.js adds `appear` to each section once its blocks have loaded.
    await page.waitForFunction(
      () => !document.querySelector('main .section:not([data-section-status="loaded"])'),
      null,
      { timeout: 10000 },
    ).catch(() => errors.push('sections did not reach loaded status'));

    await page.screenshot({ path: path.join(dir, `target-${width}.png`), fullPage: true });
    results.push({ slug, width, errors: [...new Set(errors)] });
    await page.close();
  }

  const errs = results.filter((r) => r.slug === slug).flatMap((r) => r.errors);
  console.log(`${errs.length ? 'ERR ' : 'OK  '} ${slug.padEnd(46)} ${errs.slice(0, 2).join(' | ')}`);
}

for (const slug of [...new Set(slugs)]) {
  const draft = PAGE_DRAFTS[slug] || slug;
  const sections = await readFile(path.join(ROOT, 'drafts/imported', `${draft}.plain.html`), 'utf8')
    .catch(() => null);
  if (sections === null) {
    console.log(`SKIP  ${slug} (no draft ${draft}.plain.html)`);
  } else {
    await renderPage(slug, sections);
  }
}

await browser.close();
console.log(`\n${results.length} screenshots · ${results.filter((r) => r.errors.length).length} with console errors`);
