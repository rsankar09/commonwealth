/*
 * AEM Importer transform — commonwealth.globalatlantic.com (Drupal 10) → EDS.
 *
 * Target is the *xwalk* (Universal Editor) import, so every block table here
 * mirrors its block's MODEL, not the visual shape of the source page:
 *
 *   - Hero  is a simple block: one row per model property group, one cell per
 *           row, in model order  → row 1 image (+imageAlt), row 2 text.
 *           `classes` is carried in the block name, not in a row.
 *   - Cards is a container block: one row per card item, one cell per property
 *           of that item → cell 1 image, cell 2 text.
 *
 * Absent properties still emit their (empty) row/cell — skipping one shifts
 * every later property up by a slot and silently files the text as the image.
 *
 * Contracts are asserted against blocks/hero/_hero.json and
 * blocks/cards/_cards.json by tools/importer/verify.mjs; change one and the
 * verifier fails before an import can run.
 */

/* global WebImporter */

const SOURCE_ORIGIN = 'https://commonwealth.globalatlantic.com';

/** Where migrated binaries land in AEM. Kept in sync with the asset manifest. */
const DAM_ROOT = '/content/dam/commonwealth';

/**
 * Modal trigger id prefix → fragment folder.
 * The source uses `#policy-*` on /policyholders and `#agent-*` on /agentbrokers
 * for what are almost the same five dialogs; they are kept apart because the
 * two copies are NOT byte-identical (see verify report: Commonwealth MYGA).
 */
const MODAL_FRAGMENT_ROOTS = {
  policy: '/fragments/policy-prefix',
  agent: '/fragments/agent-prefix',
};

/**
 * Human titles for the migrated press releases. The /newsroom page links these
 * four documents by title; /node/101 links the same four by raw filename, so
 * the filename is resolved back to the newsroom title rather than migrated as
 * `Primary_Press_Release_Final.pdf`.
 */
const PDF_TITLES = {
  'Global_Atlantic_Financial_Group_Completes_Separation_from_Goldman_Sachs.pdf':
    'Global Atlantic Financial Group Completes Separation from Goldman Sachs',
  'Primary_Press_Release_Final.pdf':
    'Global Atlantic Financial Group Agrees to Acquire Forethought Financial Group',
  'Aviva_Press_release_Close_-_Final.pdf':
    "Global Atlantic Financial Group Completes Acquisition of Aviva USA's Life Insurance Business",
  'Global_Atlantic_Completes_Acquisition_of_Forethought_Financial_Group.pdf':
    'Global Atlantic Completes Acquisition of Forethought Financial Group',
};

/** Drupal/RDFa bookkeeping that must not reach the target markup. */
const JUNK_ATTRIBUTES = [
  'about', 'typeof', 'property', 'content', 'datatype', 'rel', 'lang', 'hreflang',
  'data-entity-type', 'data-entity-uuid', 'data-drupal-link-system-path',
  'data-history-node-id', 'data-quickedit-field-id', 'loading', 'cellpadding',
  'cellspacing', 'border',
];

/* -------------------------------------------------------------------------
 * assets
 * ---------------------------------------------------------------------- */

/**
 * Resolves a source URL to an absolute one the importer can fetch, undoing the
 * two Drupal-isms that would otherwise migrate a derivative instead of the
 * original: the `styles/<preset>/public/` image-style path and the `?itok=`
 * signature that expires with the source site.
 * @param {string} value raw src/href from the source markup
 * @returns {string} absolute URL on the source origin, or the value unchanged
 *          if it is already external
 */
export function absoluteUrl(value) {
  if (!value) return value;
  let url;
  try {
    url = new URL(value, SOURCE_ORIGIN);
  } catch (e) {
    return value;
  }
  if (url.origin !== SOURCE_ORIGIN) return url.href;
  url.pathname = url.pathname.replace(/\/styles\/[^/]+\/public\//, '/');
  url.searchParams.delete('itok');
  url.search = url.searchParams.toString();
  return url.href;
}

/** @param {string} value a URL @returns {boolean} true if it addresses a binary */
function isAsset(value) {
  return /\.(pdf|jpe?g|png|gif|webp|svg|docx?|xlsx?|zip|mp4)(\?|#|$)/i.test(value);
}

/**
 * Rewrites an `href`.
 *
 * Assets are made absolute so the importer can fetch and re-upload them, but
 * page links must NOT be: an absolute link back to the source origin leaves
 * the migrated site depending on the old one staying up, which is the failure
 * that surfaces at decommissioning. Internal page links stay root-relative and
 * therefore resolve against whichever host the content is served from.
 *
 * @param {string} value raw href
 * @returns {string} rewritten href
 */
export function rewriteHref(value) {
  if (!value) return value;
  // Already a target-side path (a fragment the transform itself just wrote).
  if (value.startsWith('/fragments/')) return value;
  let url;
  try {
    url = new URL(value, SOURCE_ORIGIN);
  } catch (e) {
    return value;
  }
  if (url.origin !== SOURCE_ORIGIN) return url.href;
  if (isAsset(url.pathname)) return absoluteUrl(url.href);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Target DAM path for a migrated binary. `/sites/commonwealth/files/2021-08/x.jpg`
 * becomes `/content/dam/commonwealth/2021-08/x.jpg`; the date folders are kept
 * because they are the only grouping the source has.
 * @param {string} value source URL
 * @returns {string|null} DAM path, or null for assets hosted off-site
 */
export function damPath(value) {
  const href = absoluteUrl(value);
  if (!href.startsWith(SOURCE_ORIGIN)) return null;
  const { pathname } = new URL(href);
  const rest = decodeURIComponent(pathname)
    .replace(/^\/sites\/commonwealth\/files\//, '')
    .replace(/^\/sites\/commonwealth\/themes\/commonwealth\//, 'theme/')
    .replace(/^\//, '');

  // Source filenames carry spaces and parentheses (`Commonwealth Annuity.jpg`,
  // `download (5).jpeg`). They survive in the DAM but force percent-encoding
  // into every reference, so they are normalised once, here, where the content
  // rewrite and the upload both read the same answer.
  const safe = rest.split('/').map((segment) => segment
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')).join('/');

  return `${DAM_ROOT}/${safe}`;
}

/* -------------------------------------------------------------------------
 * cleanup
 * ---------------------------------------------------------------------- */

/** @param {string} text @returns {string} text with nbsp folded to a space */
function denbsp(text) {
  return text.replace(/\u00a0/g, ' ');
}

/**
 * Strips Drupal bookkeeping attributes and presentational classes, rewrites
 * asset references to absolute URLs, and drops the theme's empty spacer nodes.
 * @param {Element} root subtree to clean, modified in place
 */
export function scrub(root) {
  // The root itself is in scope — `scrub()` is called on bare `<img>` clones,
  // where every attribute worth removing is on the root and nowhere else.
  [root, ...root.querySelectorAll('*')].forEach((el) => {
    JUNK_ATTRIBUTES.forEach((attr) => el.removeAttribute(attr));
    if (el.hasAttribute('src')) el.setAttribute('src', absoluteUrl(el.getAttribute('src')));
    if (el.hasAttribute('href')) el.setAttribute('href', rewriteHref(el.getAttribute('href')));
  });

  // The theme separates inline links with a literal nbsp. Markdown drops it,
  // welding `Contact Info >` onto `Login >`; a normal space survives.
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach((node) => { node.nodeValue = denbsp(node.nodeValue); });

  // The theme marks the former-name line with `.note`; it is emphasis, and the
  // cards CSS styles it from `em`. Convert rather than carry the class over.
  root.querySelectorAll('span.note').forEach((span) => {
    const em = root.ownerDocument.createElement('em');
    em.innerHTML = span.innerHTML;
    span.replaceWith(em);
  });

  [root, ...root.querySelectorAll('*')].forEach((el) => {
    el.removeAttribute('class');
    el.removeAttribute('style');
  });

  // `<h4><br>Transamerica ...` — the source uses a leading break for spacing.
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    while (h.firstChild && h.firstChild.nodeName === 'BR') h.firstChild.remove();
  });

  // Whitespace-only paragraphs and headings (contact-us has five) carry no
  // content and would import as empty text components.
  //
  // Block elements only. An inline `<span> </span>` looks just as empty but is
  // load-bearing: the importer's own preprocessing rewrites the nbsp between
  // `Contact Info >` and `Login >` into exactly that, and removing it welds
  // the two links together in the markdown.
  root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div').forEach((el) => {
    if (!el.querySelector('img, picture, a, iframe, table') && !denbsp(el.textContent).trim()) {
      el.remove();
    }
  });
}

/**
 * Promotes the page's leading `h2` to `h1`.
 *
 * No source page has an `h1` — the Drupal theme renders the page title as `h2`
 * inside the body field — so migrating verbatim would ship 20 pages with no
 * top-level heading.
 * @param {Element} root body content, modified in place
 */
export function promotePageTitle(root) {
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  const [first] = headings;
  if (!first || first.tagName !== 'H2') return;

  // Every heading below the title moves up with it, so the relative hierarchy
  // the author wrote is preserved exactly and only the offset changes. Source
  // `h2 → h4` (a one-level gap) would otherwise become `h1 → h4`, a two-level
  // gap, which is a worse heading order than the page started with.
  headings.forEach((h) => {
    const level = Number(h.tagName[1]);
    const promoted = root.ownerDocument.createElement(`h${Math.max(1, level - 1)}`);
    promoted.innerHTML = h.innerHTML;
    h.replaceWith(promoted);
  });
}

/* -------------------------------------------------------------------------
 * hero (banner) — page-banner component
 * ---------------------------------------------------------------------- */

/**
 * Builds the Hero block from the Drupal `.content-banner-section` band.
 *
 * MODEL ORDER (blocks/hero/_hero.json): image (+imageAlt collapsed) → text.
 * The source DOM is the other way round — the grey sidebar precedes the image —
 * so the two are read by selector, never by position. `classes` rides in the
 * block name.
 *
 * The decorative four-colour rule under the band (`.content-banner-color`) is
 * generated by hero.js and is deliberately not migrated as content.
 *
 * @param {Document} document owner document
 * @param {Element} banner the `.content-banner-section` element
 * @returns {Element} the block table
 */
export function buildHeroBanner(document, banner) {
  const img = banner.querySelector('.cw-banner-image img');
  const aside = banner.querySelector('.content-top-right .field__item');

  let imageCell = '';
  if (img) {
    const clone = img.cloneNode(true);
    scrub(clone);
    clone.setAttribute('src', absoluteUrl(img.getAttribute('src')));
    // Alt is the collapsed `imageAlt` property; losing it loses the field.
    if (!clone.getAttribute('alt')) clone.setAttribute('alt', '');
    imageCell = clone;
  }

  let textCell = '';
  if (aside) {
    const clone = aside.cloneNode(true);
    scrub(clone);
    // The two links are a `ul` in the source. They are re-authored as
    // standalone paragraphs, for two reasons: it is the shape the boilerplate
    // turns into buttons (and the shape hero.css is written against), and a
    // list inside a richtext field comes back out of md2jcr as `<p><ul>…</ul></p>`,
    // which the parser then splits into an empty leading paragraph.
    clone.querySelectorAll('ul, ol').forEach((list) => {
      const paragraphs = [...list.querySelectorAll('li')].map((li) => {
        const p = document.createElement('p');
        p.innerHTML = li.innerHTML.trim();
        return p;
      });
      list.replaceWith(...paragraphs);
    });
    if (clone.textContent.trim()) textCell = [...clone.childNodes];
  }

  // Two rows, one cell each — one per model property group, in model order.
  // Both rows are emitted even when empty (node/161 has no banner image).
  return WebImporter.DOMUtils.createTable([
    ['Hero (banner)'],
    [imageCell],
    [textCell],
  ], document);
}

/* -------------------------------------------------------------------------
 * cards (companies) — company-link-columns component
 * ---------------------------------------------------------------------- */

/**
 * Splits a `.content-right-sec-bottom-*` half into one fragment per company,
 * using the `h4` company names as boundaries.
 * @param {Element} half the half element, or null
 * @returns {Element[][]} a list of node-lists, one per company
 */
function splitCompanies(half) {
  if (!half) return [];
  const field = half.querySelector('.field__item') || half;
  const groups = [];
  [...field.children].forEach((child) => {
    if (child.tagName === 'H4') groups.push([]);
    if (groups.length) groups[groups.length - 1].push(child);
  });
  return groups;
}

/**
 * Builds the Cards block from the two-column company list.
 *
 * The source is two stacked halves (3 companies left, 2 right) but reads
 * row-wise on screen, so the halves are interleaved — left[0], right[0],
 * left[1] … — to preserve the authored order. Reading them sequentially would
 * silently reorder the five companies.
 *
 * MODEL (blocks/cards/_cards.json): `cards` is a container whose child `card`
 * has image → text. Each company is therefore one ROW of TWO CELLS, and the
 * empty image cell is emitted rather than skipped.
 *
 * @param {Document} document owner document
 * @param {Element} bottom the `.content-right-sec-bottom` element
 * @param {string} modalPrefix `policy` or `agent`, selecting the fragment root
 * @returns {Element|null} the block table, or null if no companies were found
 */
export function buildCompanyCards(document, bottom, modalPrefix) {
  const left = splitCompanies(bottom.querySelector('.content-right-sec-bottom-left'));
  const right = splitCompanies(bottom.querySelector('.content-right-sec-bottom-right'));

  const ordered = [];
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i]) ordered.push(left[i]);
    if (right[i]) ordered.push(right[i]);
  }
  if (!ordered.length) return null;

  const rows = ordered.map((group) => {
    const cell = document.createElement('div');
    group.forEach((node) => cell.append(node.cloneNode(true)));

    // The company name is the card's own heading. The source says `h4` under
    // an `h2` page title; with the title promoted to `h1` these become `h2`,
    // the first level below it. cards.css styles h1-h6 in a card body
    // identically, so this is a semantics change only.
    cell.querySelectorAll('h4').forEach((h4) => {
      const h2 = document.createElement('h2');
      h2.innerHTML = h4.innerHTML;
      h4.replaceWith(h2);
    });

    // `<a class="popup-btn" href="#" data-target-id="#policy-x">` is a modal
    // trigger. The modal block keys off the href, so the dead `#` becomes the
    // path of the fragment document holding that dialog's body.
    cell.querySelectorAll('a[data-target-id]').forEach((a) => {
      const id = a.getAttribute('data-target-id').replace(/^#/, '');
      const [, slug] = id.match(new RegExp(`^(${modalPrefix})-(.+)$`)) || [];
      const rest = id.replace(new RegExp(`^${modalPrefix}-`), '');
      a.setAttribute('href', `${MODAL_FRAGMENT_ROOTS[modalPrefix]}/${slug ? rest : id}`);
      a.removeAttribute('data-target-id');
    });

    scrub(cell);
    // Cell 1 image (always empty here), cell 2 text — the card model's order.
    return ['', [...cell.childNodes]];
  });

  return WebImporter.DOMUtils.createTable([['Cards (companies)'], ...rows], document);
}

/* -------------------------------------------------------------------------
 * modal bodies — policy-prefix-modal component
 * ---------------------------------------------------------------------- */

/**
 * Merges the dialog's two side-by-side `product-prefix` tables back into one.
 *
 * The split is purely a height trick in the source — the right table continues
 * the left one alphabetically — so migrating it as two tables would force
 * authors to rebalance both halves by hand whenever a product is added.
 *
 * The result is a `Table` BLOCK, not a bare `<table>`: in EDS every table in a
 * document is read as a block, so a bare one would be imported as a block
 * called "Product".
 *
 * @param {Document} document owner document
 * @param {Element} content the `.popup-content` element
 * @returns {Element|null} the Table block, or null if the dialog has no table
 */
function buildPrefixTable(document, content) {
  const tables = [...content.querySelectorAll('table')];
  if (!tables.length) return null;

  const headers = [...tables[0].querySelectorAll('thead th')]
    .map((th) => denbsp(th.textContent).trim());

  const body = [];
  tables.forEach((table) => {
    table.querySelectorAll('tbody tr').forEach((tr) => {
      body.push([...tr.children].map((td) => {
        const cell = document.createElement('div');
        cell.innerHTML = td.innerHTML;
        scrub(cell);
        return cell;
      }));
    });
  });

  return WebImporter.DOMUtils.createTable([['Table'], headers, ...body], document);
}

/**
 * Extracts each `.popup-box` into its own fragment document.
 * @param {Document} document owner document
 * @param {Element} article the page article
 * @param {string} modalPrefix `policy` or `agent`
 * @returns {{element: Element, path: string}[]} extra documents to write
 */
export function buildModalFragments(document, article, modalPrefix) {
  const wrapper = article.querySelector('.cw-modal-popups');
  if (!wrapper) return [];

  return [...wrapper.querySelectorAll('.popup-box')].map((box) => {
    const slug = box.id.replace(/-box$/, '').replace(new RegExp(`^${modalPrefix}-`), '');
    const content = box.querySelector('.popup-content');
    const root = document.createElement('div');

    const heading = content.querySelector('h3');
    if (heading) {
      const h2 = document.createElement('h2');
      h2.innerHTML = heading.innerHTML;
      root.append(h2);
    }

    const table = buildPrefixTable(document, content);
    if (table) root.append(table);

    return { element: root, path: `${MODAL_FRAGMENT_ROOTS[modalPrefix]}/${slug}` };
  });
}

/* -------------------------------------------------------------------------
 * pdf lists — pdf-link-list / pdf-file-field components
 * ---------------------------------------------------------------------- */

/**
 * Normalises the two PDF listings to one shape: a plain `ul` of links, no
 * inline icons.
 *
 * /newsroom repeats `pdf_icon.gif` before every link with inconsistent markup
 * (`class="icon"` on three of four, alt alternating between "pdf-icon" and
 * "PDF Icon"). The icon is presentation and belongs in global CSS via
 * `a[href$=".pdf"]`, so it is dropped from the content here.
 *
 * @param {Element} root body content, modified in place
 */
export function normalisePdfLinks(root) {
  root.querySelectorAll('a[href$=".pdf"]').forEach((a) => {
    const href = absoluteUrl(a.getAttribute('href'));
    a.setAttribute('href', href);
    const filename = decodeURIComponent(href.split('/').pop());
    const title = PDF_TITLES[filename];
    // Only substitute when the link text IS the filename; never overwrite a
    // title an author already wrote.
    if (title && denbsp(a.textContent).trim() === filename) a.textContent = title;
  });

  root.querySelectorAll('img').forEach((img) => {
    if (/pdf_icon/i.test(img.getAttribute('src') || '')) img.remove();
  });
}

/**
 * Rebuilds the `/node/101` Drupal file-field widget as an ordinary link list.
 * The `Upload PDF files` label, the per-file `span.file` wrappers and the
 * submitted-by byline are CMS chrome with no counterpart in EDS.
 * @param {Document} document owner document
 * @param {Element} nodeContent the `.node__content` element
 * @returns {Element} a `ul` of document links
 */
export function buildFileFieldList(document, nodeContent) {
  const list = document.createElement('ul');
  nodeContent.querySelectorAll('.field--name-field-upload-pdf-files .field__item a')
    .forEach((a) => {
      const li = document.createElement('li');
      const link = a.cloneNode(true);
      link.removeAttribute('type');
      li.append(link);
      list.append(li);
    });
  return list;
}

/* -------------------------------------------------------------------------
 * page assembly
 * ---------------------------------------------------------------------- */

/**
 * Builds the body of a standard content page.
 * @param {Document} document owner document
 * @param {Element} article the page article
 * @param {string} modalPrefix `policy`, `agent` or ''
 * @returns {Node[]} body nodes
 */
function buildBody(document, article, modalPrefix) {
  const out = [];

  const fullwidth = article.querySelector('.cw-content-section-fullwidth .field__item');
  const rightSec = article.querySelector('.cw-content-section > .content-right-sec .field__item');
  const leftSec = article.querySelector('.cw-content-section > .content-left-sec .field__item');
  const bottom = article.querySelector('.content-right-sec-bottom');

  const mainField = rightSec || fullwidth;
  const mainContent = document.createElement('div');
  if (mainField) {
    [...mainField.cloneNode(true).childNodes].forEach((n) => mainContent.append(n));
    scrub(mainContent);
    normalisePdfLinks(mainContent);
    promotePageTitle(mainContent);
  }

  if (leftSec) {
    // A 3/9 sidebar beside the body (only /about-us in the live set). Kept as a
    // columns block so the desktop layout survives; it collapses to the same
    // stacked order the source itself falls back to below 768px.
    const aside = document.createElement('div');
    [...leftSec.cloneNode(true).childNodes].forEach((n) => aside.append(n));
    scrub(aside);
    out.push(WebImporter.DOMUtils.createTable([
      ['Columns'],
      [[...aside.childNodes], [...mainContent.childNodes]],
    ], document));
  } else {
    out.push(...mainContent.childNodes);
  }

  if (bottom && modalPrefix) {
    const cards = buildCompanyCards(document, bottom, modalPrefix);
    if (cards) out.push(cards);
  }

  return out;
}

/**
 * Metadata block.
 *
 * The source carries only `<title>` and a canonical link — no description, no
 * Open Graph tags — so Title is all there is to migrate. An `Image` row was
 * tried and removed: the xwalk page model (models/_page.json) exposes only
 * jcr:title, jcr:description and keywords, so md2jcr drops anything else on
 * the floor without warning. Add the field to the page model first if the
 * client wants social images.
 *
 * @param {Document} document owner document
 * @returns {Element|null} the Metadata block, or null when there is nothing
 */
export function buildMetadata(document) {
  const title = (document.querySelector('title')?.textContent || '')
    // Every page ends " | commonwealth"; the site name is the target site's
    // job, and a literal pipe would have to be escaped in the block table.
    .replace(/\s*\|\s*commonwealth\s*$/i, '')
    .trim();
  if (!title) return null;

  return WebImporter.DOMUtils.createTable([['Metadata'], ['Title', title]], document);
}

/**
 * Target document path. `/` becomes `/index`; `/node/101` is the site's one
 * real orphan and is given the alias the newsroom implies.
 * @param {string} url source URL
 * @returns {string} target path
 */
export function documentPath(url) {
  const { pathname } = new URL(url);
  if (pathname === '/' || pathname === '') return '/index';
  if (pathname === '/node/101') return '/newsroom/pdf-files';
  return pathname.replace(/\/$/, '').replace(/\.html$/, '');
}

export default {
  /**
   * @param {{document: Document, url: string}} ctx importer context
   * @returns {{element: Element, path: string}[]} the page plus any fragments
   */
  transform: ({ document, url }) => {
    const article = document.querySelector('article');
    const main = document.createElement('div');
    const results = [];

    // Which family of dialogs this page carries, read off the trigger ids the
    // source uses (`#policy-*` on /policyholders, `#agent-*` on /agentbrokers).
    const modalPrefix = Object.keys(MODAL_FRAGMENT_ROOTS)
      .find((prefix) => document.querySelector(`a[data-target-id^="#${prefix}-"]`)) || '';

    if (!article) {
      // Nothing recognisable: emit the raw body rather than an empty page, so
      // the QA diff shows the content instead of silently losing it.
      main.append(...document.body.childNodes);
    } else {
      const banner = article.querySelector('.content-banner-section');
      if (banner) {
        main.append(buildHeroBanner(document, banner));
        main.append(document.createElement('hr'));
      }

      const nodeContent = article.querySelector('.node__content');
      if (nodeContent && nodeContent.querySelector('.field--name-field-upload-pdf-files')) {
        // /node/101: a bare file-field page with no banner and no heading.
        const h1 = document.createElement('h1');
        h1.textContent = (document.querySelector('title')?.textContent || '')
          .replace(/\s*\|\s*commonwealth\s*$/i, '').trim();
        if (h1.textContent) main.append(h1);
        const list = buildFileFieldList(document, nodeContent);
        normalisePdfLinks(list);
        main.append(list);
      } else if (nodeContent) {
        const body = nodeContent.cloneNode(true);
        body.querySelectorAll('.node__links, .node__meta, .comment-wrapper, .field--name-field-tags').forEach((el) => el.remove());
        scrub(body);
        promotePageTitle(body);
        main.append(...body.childNodes);
      } else {
        main.append(...buildBody(document, article, modalPrefix));
      }

      if (modalPrefix) {
        results.push(...buildModalFragments(document, article, modalPrefix));
      }
    }

    // No section break before Metadata: md2jcr folds the block into the page
    // node, so a section of its own would import as an empty trailing section.
    const metadata = buildMetadata(document);
    if (metadata) main.append(metadata);

    return [{ element: main, path: documentPath(url) }, ...results];
  },
};
