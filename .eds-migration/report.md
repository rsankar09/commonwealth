# Import transform — QA report

Transform: `tools/importer/import.js`
Harness: `tools/importer/verify.mjs` (contracts + content diff), `tools/importer/preview.mjs` (render + screenshot)
Run: all 23 captured pages; 20 imported, 3 excluded as flagged test content.

```
20 pages · 30 documents · 23 assets · 0 contract problems · 2 pages blocked on unported blocks
```

## How this was verified

Not by eyeballing markdown. Each page goes source HTML → `import.js` → markdown →
**JCR XML**, using the project's own aggregated `component-models.json` /
`component-definition.json` / `component-filters.json`. The JCR is the artefact that
proves a block table landed on the right *model property* — a page can render
perfectly while every field is filed one slot off.

`verify.mjs` additionally reads the emitted row/cell counts back out of the markdown
and asserts them against `blocks/hero/_hero.json` and `blocks/cards/_cards.json`. If
either model changes, the run fails before an import can happen.

Confirmed from the generated JCR:

| Block | Emitted | Model properties reached |
|---|---|---|
| Hero (banner) ×19 | 2 rows × 1 cell | `image`, `imageAlt`, `text`, `classes="banner"` |
| Cards (companies) ×2 | 5 rows × 2 cells | container `cards` + 5 `item_N` of model `card`, `text` set, `image` empty |
| Columns ×1 | 1 row × 2 cells | `columns=2`, `rows=1`, `col1`/`col2` with separate title/text components |
| Metadata ×20 | folded into `jcr:content/@jcr:title` | — |

## Per-page result

| Page | Blocks | Result |
|---|---|---|
| home | Hero | PASS |
| about-us | Hero, Columns | PASS (see D2) |
| products, reinsurance-solutions, contact-us, disclosures | Hero | PASS |
| newsroom | Hero + link list | PASS |
| policyholders | Hero, Cards, 5 fragments | **BLOCKED** (B1) |
| agentbrokers | Hero, Cards, 5 fragments | **BLOCKED** (B1) |
| 10 × company detail pages | Hero | PASS |
| node-101 (newsroom PDF files) | link list | WARN (D4) |

Content diff (`pages/<slug>/diff.json`) shows **zero dropped words** on 19 of 20 pages.
The one exception is node-101, where the dropped tokens are all Drupal chrome
(`Submitted by cwadmin`, the `Upload PDF files` field label) plus the raw filenames
that were deliberately replaced with human titles.

## Blockers — must be resolved before a bulk import

**B1. Two blocks are not in `/blocks` yet.**

- `table` — **hard blocker.** In EDS every table in a document is read as a block, so
  the product/prefix tables cannot be "plain default content" as `mapping.json`
  assumed; they need the Table block. `md2jcr` refuses the 10 modal fragments today
  with *"The component 'Table' does not exist"*. This corrects the
  `pdf-link-list`/`policy-prefix-modal` note in the mapping.
- `modal` — runtime blocker, not an import blocker. The fragment documents import
  fine once Table exists; without the modal block the trigger links navigate to the
  fragment page instead of opening a dialog.

Both are `eds-block-authoring` work. The transform already emits the correct target
shape for both, so nothing here changes when they land.

## Decisions taken — please confirm

**D1. Modal fragments are duplicated per section, not shared.** 10 fragments
(`/fragments/policy-prefix/*` and `/fragments/agent-prefix/*`) rather than 5.
Four of the five dialogs are byte-identical between /policyholders and /agentbrokers,
but **Commonwealth Annuity is not**: the policyholder copy has a
`Commonwealth MYGA | 905` row the agent copy lacks (39 rows vs 38). Fidelity was
chosen over de-duplication — migrating 5 shared fragments would silently add a
product row to one audience or drop it from the other. If the client confirms MYGA
belongs on both, collapse to 5 fragments and point both card sets at them.

**D2. `/about-us` uses a Columns block for its sidebar.** Content is complete and
correctly split, but two things differ from the source:
- the columns render 50/50, source is 3/9;
- `columns.css` sets `align-items: center`, so "Newsroom" floats to the vertical
  middle instead of sitting at the top.

Either add a columns variant (3/9, top-aligned), or drop to two stacked sections —
which is what the source itself does below 768px. This affects one real page.
Related: the sidebar `h2` precedes the page `h1` in DOM order, inherent to
sidebar-first columns. Lifting the `h1` above the block would fix the heading order
but move the title's underline rule to full width.

**D3. Headings are shifted up one level site-wide.** No source page has an `h1` —
the Drupal theme renders the page title as `h2` in the body field — so the leading
`h2` is promoted and *every* heading below it moves with it. Relative hierarchy is
preserved exactly; only the offset changes. Company names in the cards go `h4` → `h2`
(first level under the page title). cards.css styles h1–h6 identically, so this is a
semantics change only.

**D4. `/node/101` is routed to `/newsroom/pdf-files`.** The site's one real orphan
had no path alias. It also has no heading, so the `<title>` is promoted to `h1` —
which means the page ships the source's typo, *"Newroom PDF files"*. Worth fixing in
content rather than in the transform.

**D5. Test pages excluded.** `/node/71`, `/node/76`, `/node/161` carry
`test_content: true` in the capture and are skipped. `INCLUDE_TEST=1` imports them.

**D6. Site-name suffix stripped from titles.** `About Us | commonwealth` imports as
`About Us`. The site name belongs to the target site, and a literal pipe would have to
be escaped inside the Metadata block.

## Follow-ups outside this transform

- **PDF icon.** The inline `pdf_icon.gif` images are dropped as the mapping directed,
  but the replacement global rule (`a[href$=".pdf"]`) has not been written, so the
  newsroom list currently shows no icon at all. `styles/styles.css`.
- **Page title styling.** The promoted `h1` renders large and bold; the source is a
  light grey serif with a full-width rule. `styles/styles.css`.
- **Body measure.** The source offsets body content to align under the 9-col banner
  image, leaving the left three columns empty. The import uses the full section width.
  Confirm which is wanted.
- **Header submenu.** The source expands the active trail's submenu as a visible
  second row; the boilerplate header uses `.nav-drop` toggles. Pre-existing site-nav
  mapping behaviour, not a transform effect.
- **Metadata has no description or Open Graph data**, because the source has none. An
  `Image` row was tried and removed: `models/_page.json` exposes only `jcr:title`,
  `jcr:description` and `keywords`, so `md2jcr` discards anything else without
  warning. Add the field to the page model first if social images are wanted.

## One change made outside `import.js`

`blocks/cards/cards.css` — added `.cards .cards-card-body p:empty { display: none }`.
A heading at the top of a rich-text field arrives from `md2jcr` wrapped as
`<p><h2>…</h2></p>`, which the parser splits into an empty paragraph plus the heading,
adding 16px above every company name. Move this to the block-authoring stage if you
prefer to keep block CSS out of the import step.

## Assets

23 assets (19 images, 4 PDFs) in `assets/manifest.json`, each with its source URL,
target DAM path and the pages referencing it. No name collisions.

Source filenames carry spaces and parentheses (`Commonwealth Annuity.jpg`,
`download (5).jpeg`); `damPath()` normalises them to lowercase-hyphenated so the
content rewrite and the upload can never disagree — the verifier asks the transform
for the path rather than recomputing it.

Content still carries absolute source URLs for binaries, deliberately: that is how
the importer finds them to download. Internal **page** links are rewritten to
root-relative, so the migrated site does not depend on the source host staying up.

## Reproducing

```bash
mkdir -p /tmp/eds-import-tools && cd /tmp/eds-import-tools
npm init -y && npm i @adobe/helix-importer jsdom

cd /path/to/commonwealth
IMPORT_TOOLS=/tmp/eds-import-tools/node_modules node tools/importer/verify.mjs

# visual QA (needs `npx @adobe/aem-cli up --no-open` in another shell)
PLAYWRIGHT_PATH=/tmp/eds-crawl-tools/node_modules/playwright/index.mjs \
  node tools/importer/preview.mjs
```

Re-aggregate the model JSONs (`npm run build:json`) before handing off to
`eds-author-upload` if any block model changed — the importer derives cell structure
from the aggregate, so a stale one imports the old shape.
