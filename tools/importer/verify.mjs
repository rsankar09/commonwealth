/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/* eslint-env node, es2022 */
/**
 * Runs tools/importer/import.js against the capture bundle and QAs the result.
 *
 * Produces the side-by-side artefacts the migration contract requires:
 *   .eds-migration/pages/<slug>/{target.html,target.md,target.jcr.xml,diff.json}
 *   .eds-migration/assets/manifest.json
 *   .eds-migration/report.md
 *
 * The important check is not that the pages render — it is that every block
 * table lands on the MODEL property it was meant to. `assertBlockContracts`
 * reads the row/cell shape back out of the emitted markdown and compares it to
 * the block's own model partial, and `jcrProperties` reads the property names
 * out of the generated JCR XML. Either one failing fails the run.
 *
 * jsdom and @adobe/helix-importer are not project dependencies (EDS ships no
 * build step), so they are resolved from a scratch install the same way
 * capture.mjs resolves Playwright:
 *
 *   mkdir -p /tmp/eds-import-tools && cd /tmp/eds-import-tools
 *   npm init -y && npm i @adobe/helix-importer jsdom
 *
 *   cd /path/to/commonwealth
 *   IMPORT_TOOLS=/tmp/eds-import-tools/node_modules node tools/importer/verify.mjs
 *   IMPORT_TOOLS=... ONLY=policyholders,newsroom node tools/importer/verify.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TOOLS = process.env.IMPORT_TOOLS || path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, '.eds-migration');
const CAPTURE = path.join(ROOT, 'capture');
const ORIGIN = 'https://commonwealth.globalatlantic.com';

const { JSDOM } = await import(path.join(TOOLS, 'jsdom/lib/api.js'));
const { html2md, DOMUtils, Blocks } = await import(path.join(TOOLS, '@adobe/helix-importer/src/index.js'));
const { md2jcr: mdToJcr } = await import(path.join(TOOLS, '@adobe/helix-md2jcr/src/index.js'));

// The transform is written against the importer's browser sandbox, where
// WebImporter is a global.
globalThis.WebImporter = { DOMUtils, Blocks };
const importModule = await import(path.join(ROOT, 'tools/importer/import.js'));
const transformer = importModule.default;
const { damPath } = importModule;

const components = {
  models: JSON.parse(readFileSync(path.join(ROOT, 'component-models.json'), 'utf8')),
  definition: JSON.parse(readFileSync(path.join(ROOT, 'component-definition.json'), 'utf8')),
  filters: JSON.parse(readFileSync(path.join(ROOT, 'component-filters.json'), 'utf8')),
};

/* ---------------------------------------------------------------- contracts */

/**
 * Reads a block model partial and returns the property groups the importer
 * will fill, in model order. Companion suffixes collapse into their base
 * property and do not claim a row or a cell of their own; `classes` rides in
 * the block name.
 * @param {string} file path to the `_<block>.json` partial
 * @param {string} modelId the model to read
 * @returns {string[]} property names, in order
 */
function modelProperties(file, modelId) {
  const partial = JSON.parse(readFileSync(file, 'utf8'));
  const model = partial.models.find((m) => m.id === modelId);
  const suffixes = /(Alt|Text|Type|Title|MimeType)$/;
  const names = model.fields.map((f) => f.name).filter((n) => n !== 'classes');
  return names.filter((n) => !(suffixes.test(n) && names.some((b) => n.startsWith(b) && b !== n)));
}

const HERO_PROPS = modelProperties(path.join(ROOT, 'blocks/hero/_hero.json'), 'hero');
const CARD_PROPS = modelProperties(path.join(ROOT, 'blocks/cards/_cards.json'), 'card');

/**
 * Parses the gridtable blocks back out of generated markdown.
 * @param {string} md the markdown
 * @returns {{name: string, rows: string[][]}[]} one entry per block
 */
function parseBlocks(md) {
  const blocks = [];
  const lines = md.split('\n');
  let current = null;
  let row = null;

  const flushRow = () => {
    if (current && row) current.rows.push(row);
    row = null;
  };

  lines.forEach((line) => {
    if (/^\+[-=+]+\+$/.test(line)) {
      // A `=` rule closes the header; a `-` rule closes a body row.
      flushRow();
    } else if (/^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1);
      if (!current) {
        current = { name: cells.join('').trim(), rows: [] };
        blocks.push(current);
      } else if (!row) {
        row = cells.map((c) => c.trim());
      } else {
        row = row.map((c, i) => `${c} ${(cells[i] || '').trim()}`.trim());
      }
    } else {
      // Any line that is not part of a gridtable ends the current one. A blank
      // line inside a cell is still written with its pipes, so a truly empty
      // line is always a table boundary — treating it as continuation welded
      // the next block's header row on as an extra item.
      flushRow();
      current = null;
    }
  });
  flushRow();
  return blocks;
}

/**
 * Asserts each emitted block against its model's property list.
 * @param {string} md generated markdown
 * @returns {string[]} contract violations, empty when the page is clean
 */
function assertBlockContracts(md) {
  const problems = [];
  for (const block of parseBlocks(md)) {
    const name = block.name.toLowerCase();
    if (name.startsWith('hero')) {
      if (block.rows.length !== HERO_PROPS.length) {
        problems.push(`Hero: ${block.rows.length} rows, model has ${HERO_PROPS.length} properties (${HERO_PROPS.join(', ')})`);
      }
      block.rows.forEach((r, i) => {
        if (r.length !== 1) problems.push(`Hero row ${i + 1} (${HERO_PROPS[i]}): ${r.length} cells, expected 1`);
      });
    }
    if (name.startsWith('cards')) {
      block.rows.forEach((r, i) => {
        if (r.length !== CARD_PROPS.length) {
          problems.push(`Cards item ${i + 1}: ${r.length} cells, card model has ${CARD_PROPS.length} properties (${CARD_PROPS.join(', ')})`);
        }
      });
    }
  }
  return problems;
}

/**
 * @param {string} xml generated JCR XML
 * @returns {Record<string, string[]>} resource type → property names on it
 */
function jcrProperties(xml) {
  const out = {};
  [...xml.matchAll(/<([\w:-]+)\s+([^>]*?)\/?>/g)]
    .filter(([, , attrs]) => /sling:resourceType="/.test(attrs))
    .forEach(([, tag, attrs]) => {
      out[tag] = [...attrs.matchAll(/(?:^|\s)([\w:]+)=/g)].map((a) => a[1])
        .filter((n) => !n.startsWith('jcr:') && !n.startsWith('sling:'));
    });
  return out;
}

/* -------------------------------------------------------------------- diff */

/** @param {string} s @returns {string} comparable text */
const norm = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Text of a markup string, with element boundaries turned into spaces.
 *
 * `textContent` is not usable for the diff: it welds adjacent elements
 * together (`PolicyholdersAgents/Brokers`), which then reads as two dropped
 * words on one side and one invented word on the other.
 * @param {string} html markup
 * @returns {string} comparable text
 */
function textOf(html) {
  const stripped = html.replace(/<[^>]*>/g, ' ');
  return norm(new JSDOM(`<body>${stripped}</body>`).window.document.body.textContent);
}

/**
 * Significant words of a string, for the content diff. Punctuation is dropped
 * entirely so that `investors.` and `investors` compare equal.
 * @param {string} s text
 * @returns {Set<string>} words longer than two characters
 */
const words = (s) => new Set(norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((w) => w.length > 2));

/* ------------------------------------------------------------------- driver */

const slugs = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const all = readdirSync(CAPTURE).filter((d) => existsSync(path.join(CAPTURE, d, 'dom.json')));
// The three pages the crawl flagged `test_content` are excluded by default —
// they are Drupal scratch pages, not site content. INCLUDE_TEST=1 imports them.
const isTest = (slug) => JSON.parse(
  readFileSync(path.join(CAPTURE, slug, 'meta.json'), 'utf8'),
).test_content === true;
const pages = slugs.length
  ? all.filter((d) => slugs.includes(d))
  : all.filter((d) => process.env.INCLUDE_TEST === '1' || !isTest(d));

const assets = new Map();
const report = [];

for (const slug of pages) {
  const meta = JSON.parse(await readFile(path.join(CAPTURE, slug, 'meta.json'), 'utf8'));
  const { html } = JSON.parse(await readFile(path.join(CAPTURE, slug, 'dom.json'), 'utf8'));
  const dir = path.join(OUT, 'pages', slug);
  await mkdir(dir, { recursive: true });

  const dom = new JSDOM(html, { url: meta.url });
  const sourceArticle = dom.window.document.querySelector('article, main');
  const sourceText = sourceArticle ? textOf(sourceArticle.innerHTML) : '';
  const sourceAssets = [...dom.window.document.querySelectorAll('article img, article a[href$=".pdf"]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'));

  const entry = {
    slug, url: meta.url, docs: [], problems: [], blockers: [], dropped: [], assets: [],
  };

  // html2md and md2jcr are run separately, and the JCR step is run per
  // document. The whole-page call aborts on the first unknown component, which
  // would hide every other result on the page behind one missing block.
  let results = [];
  try {
    results = await html2md(
      meta.url,
      new JSDOM(html, { url: meta.url }).window.document,
      transformer,
      { createDocumentFromString: (s) => new JSDOM(s).window.document },
    );
  } catch (e) {
    entry.problems.push(`transform threw: ${e.message}`);
  }
  if (!Array.isArray(results)) results = [results];

  let combinedText = '';
  let combinedHtml = '';
  for (const res of results) {
    const rel = res.path.replace(/^.*?(?=\/)/, '');
    const name = rel.replace(/^\//, '').replace(/\//g, '_') || 'index';
    await writeFile(path.join(dir, `${name}.html`), res.html || '');
    if (res.md) await writeFile(path.join(dir, `${name}.md`), res.md);

    let jcr = null;
    if (res.md) {
      try {
        jcr = await mdToJcr(res.md, components);
        await writeFile(path.join(dir, `${name}.jcr.xml`), jcr);
      } catch (e) {
        // An unreferenced block is a port blocker, not a transform defect: the
        // table shape is right, the component just is not in /blocks yet.
        const missing = (e.message.match(/component '([^']+)' does not exist/) || [])[1];
        if (missing) entry.blockers.push(`${rel}: block '${missing}' is not in /blocks — port it before importing`);
        else entry.problems.push(`${rel}: md2jcr failed — ${e.message}`);
      }
    }

    combinedHtml += res.html || '';
    combinedText += ` ${textOf(res.html || '')}`;
    const problems = res.md ? assertBlockContracts(res.md) : ['no markdown produced'];
    entry.problems.push(...problems.map((p) => `${rel}: ${p}`));
    entry.docs.push({
      path: rel,
      blocks: res.md ? parseBlocks(res.md).map((b) => `${b.name} [${b.rows.length}r]`) : [],
      jcr: jcr ? jcrProperties(jcr) : null,
    });
  }

  // assets: every reference that survived into the target markup. The DAM path
  // is asked of the transform rather than recomputed, so the manifest and the
  // content rewrite can never disagree.
  const targetDom = new JSDOM(combinedHtml).window.document;
  const refs = [...targetDom.querySelectorAll('img, a[href$=".pdf"]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))
    .filter((src) => src && src.startsWith(ORIGIN));
  refs.forEach((src) => {
    const target = damPath(src);
    const existing = [...assets.values()].find((a) => a.target === target && a.source !== src);
    if (existing) entry.problems.push(`asset name collision: ${src} and ${existing.source} both map to ${target}`);
    assets.set(src, {
      source: src, target, type: src.endsWith('.pdf') ? 'application/pdf' : 'image', pages: [],
    });
    assets.get(src).pages.push(slug);
    entry.assets.push(src);
  });

  // content diff: source words absent from the target
  const srcWords = words(sourceText);
  const tgtWords = words(combinedText);
  entry.dropped = [...srcWords].filter((w) => !tgtWords.has(w));
  await writeFile(path.join(dir, 'diff.json'), JSON.stringify({
    slug,
    source_text_length: sourceText.length,
    target_text_length: norm(combinedText).length,
    dropped_words: entry.dropped,
    source_assets: sourceAssets.length,
    target_assets: entry.assets.length,
    problems: entry.problems,
    blockers: entry.blockers,
  }, null, 2));

  report.push(entry);
  let status = 'PASS';
  if (entry.problems.length) status = 'FAIL';
  else if (entry.blockers.length) status = 'BLOCK';
  else if (entry.dropped.length) status = 'WARN';
  console.log(`${status.padEnd(5)} ${slug.padEnd(46)} docs=${entry.docs.length} dropped=${entry.dropped.length}`);
  entry.problems.forEach((p) => console.log(`        ! ${p}`));
  entry.blockers.forEach((b) => console.log(`        # ${b}`));
  if (entry.dropped.length) console.log(`        ~ dropped: ${entry.dropped.slice(0, 12).join(' ')}`);
}

await mkdir(path.join(OUT, 'assets'), { recursive: true });
await writeFile(
  path.join(OUT, 'assets/manifest.json'),
  JSON.stringify([...assets.values()].sort((a, b) => a.source.localeCompare(b.source)), null, 2),
);
await writeFile(path.join(OUT, 'verify.json'), JSON.stringify(report, null, 2));

const failed = report.filter((r) => r.problems.length);
const blocked = report.filter((r) => r.blockers.length);
console.log(`\n${report.length} pages · ${assets.size} assets · ${failed.length} with contract problems · ${blocked.length} blocked on unported blocks`);
process.exitCode = failed.length ? 1 : 0;

/* ------------------------------------------------------------------ preview */

/**
 * Rewrites importer output (block *tables*) into the EDS div markup the dev
 * server serves, so the import can be rendered and diffed against the source
 * screenshot without a round trip through AEM.
 *
 * Writes drafts/imported/<slug>.plain.html. Run the dev server with
 * `--html-folder drafts` to view them.
 * @param {string} html importer output for one document
 * @returns {string} `.plain.html` body
 */
function toPlainHtml(html) {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const root = doc.body.firstElementChild;

  root.querySelectorAll('table').forEach((table) => {
    const rows = [...table.querySelectorAll('tr')];
    const name = rows[0].textContent.trim();
    // Metadata is page-level, not a rendered block.
    if (/^metadata$/i.test(name)) {
      table.remove();
      return;
    }
    const block = doc.createElement('div');
    block.className = name.toLowerCase().replace(/\(([^)]*)\)/, ' $1').replace(/\s+/g, ' ').trim();
    rows.slice(1).forEach((tr) => {
      const row = doc.createElement('div');
      [...tr.children].forEach((td) => {
        const cell = doc.createElement('div');
        cell.innerHTML = td.innerHTML;
        row.append(cell);
      });
      block.append(row);
    });
    table.replaceWith(block);
  });

  // `<hr>` is the section break; sections are sibling top-level divs.
  const sections = [[]];
  [...root.childNodes].forEach((node) => {
    if (node.nodeName === 'HR') sections.push([]);
    else sections[sections.length - 1].push(node);
  });

  return sections
    .map((nodes) => {
      const div = doc.createElement('div');
      nodes.forEach((n) => div.append(n));
      return div.innerHTML.trim() ? `<div>\n${div.innerHTML}\n</div>` : '';
    })
    .filter(Boolean)
    .join('\n');
}

await mkdir(path.join(ROOT, 'drafts/imported'), { recursive: true });
await Promise.all(report.flatMap((entry) => entry.docs.map(async (doc) => {
  const src = await readFile(
    path.join(OUT, 'pages', entry.slug, `${doc.path.replace(/^\//, '').replace(/\//g, '_') || 'index'}.html`),
    'utf8',
  );
  const name = doc.path === '/index' ? 'index' : doc.path.replace(/^\//, '').replace(/\//g, '-');
  await writeFile(path.join(ROOT, 'drafts/imported', `${name}.plain.html`), toPlainHtml(src));
})));
console.log(`previews written to drafts/imported/ (${report.reduce((n, r) => n + r.docs.length, 0)} documents)`);
