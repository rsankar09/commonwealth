# Page assembly — QA report

Harness: `tools/importer/assemble.mjs` → `.eds-migration/assemble.json`
Screenshots: `.eds-migration/pages/<slug>/assembled-<width>.png`

```
20 pages × 4 widths = 80 page-widths · 0 failing
10 fragment documents × 4 widths = 40 page-widths · 40 failing (one cause: no Table block)
1 shared-global bug found and fixed · 23/23 assets now local
```

## Widths tested

Captured widths were **375 / 768 / 1440**. The project's CSS has exactly **one**
breakpoint, `@media (width >= 900px)`. The two sets are disjoint, so the capture
tested none of the project's own switching behaviour. Runs use the union:
**375, 768, 900, 1440**.

That mattered twice:

- **900** was never captured and is where the project actually changes layout.
  It renders correctly (verified by screenshot), but nothing before this stage
  had looked at it.
- **768** is captured but sits *below* the project's 900 switch and *above* the
  source's own switch, so the two designs disagree there by construction —
  see D8.

## Assertions, per page per width

| Assertion | Result |
|---|---|
| `documentElement.scrollWidth == clientWidth` (no horizontal overflow) | pass on all 20 pages after F1 |
| every block reaches `data-block-status="loaded"` | pass |
| loaded block count == blocks in the draft | pass |
| header **and** footer blocks reach `loaded` | pass |
| no console errors | pass on 20 pages; fails on 10 fragments (B1) |
| no failed requests / non-2xx | pass on 20 pages; fails on 10 fragments (B1) |
| no unmapped source-host URLs left in the page | pass |

## Component accounting

All 7 components in `capture/mapping.json`, in source order:

| Component | Occurrences | Renders as | State |
|---|---|---|---|
| `site-nav` | 23 | `blocks/header` | present, **content hard-coded** (D6) |
| `page-footer` | 23 | `blocks/footer` | present, **content hard-coded** (D6) |
| `page-banner` | 20 | `blocks/hero` (`banner` variant) | present |
| `company-link-columns` | 2 | `blocks/cards` (text-only) | present |
| `policy-prefix-modal` | 2 | needs `table` + `modal` | **GAP — B1** |
| `pdf-link-list` | 1 | global `a[href$=".pdf"]` rule | **GAP — B2** |
| `pdf-file-field` | 1 | same rule as above | **GAP — B2** |

Nothing is unaccounted for, but three of the seven are not fully rendered yet.

## F1 — fixed at this stage

**Headings overflowed the viewport at 375px.** `styles/styles.css`.

`/policyholders/zurich-american-protective-life` and its `/agentbrokers` twin
pushed the document to **469px wide inside a 375px viewport** (+94px of
horizontal scroll). No element's box exceeded the viewport — the *text* painted
outside it, which is why a screenshot review would not have caught it and only
the `scrollWidth` assertion did.

Cause: the h1 is `Zurich American/Protective Life`; nothing breaks the token
`American/Protective`. The boilerplate sets `overflow-wrap: break-word` on
`a:any-link` only, not on headings — and headings are at their **largest** on
mobile, because the `width >= 900px` query *reduces* the scale (55px → 45px).
So the worst case lands at the narrowest viewport.

Fix: `overflow-wrap: break-word` on `h1`–`h6`. This is a shared global; it only
affects words that would otherwise overflow, and lint is clean. It changed one
other page — `/agentbrokers` at 375 grew 1675 → 1744px, because the same company
name now wraps to two lines in its card instead of overflowing silently.

## Blockers

**B1. No `table` block → 10 fragment documents fail at runtime.**
Every prefix-modal fragment 404s on `blocks/table/table.js` and
`blocks/table/table.css`, 4 failed requests and 3 console errors each, at all
four widths. This confirms `report.md`'s B1 as a *runtime* fact rather than an
import-time prediction.

Worth noting for the assertion set: these blocks still report
`data-block-status="loaded"`. The "all blocks loaded" check passes on a page
whose block JS 404'd — only the failed-request check catches it. Both are needed.

`modal` is still absent too, so even once Table lands the triggers will navigate
to the fragment page rather than open a dialog.

**B2. PDF icon rule never written.** `mapping.json` directed dropping the inline
`pdf_icon.gif` images in favour of a global `a[href$=".pdf"]` rule. The images
are dropped; the rule is not in `styles/styles.css`. `/newsroom` and
`/newsroom/pdf-files` currently show no icon at all.

Both are `eds-block-authoring` work.

## Page-height diff vs source

Source full-page screenshots floor at the 900px capture viewport, so pages
shorter than that read as exactly 900; target heights below apply the same floor.
`~` marks pairs where both are at the floor and the diff is not meaningful.

Every page is **taller** than its source, and the gap narrows as the viewport
widens. That is one cause, not twenty:

**Type scale.** The source is **12px/18px Helvetica** throughout (from
`capture/*/styles.json`). The project ships **22px mobile / 18px desktop Roboto**
at line-height 1.6 — a 1.83× larger font *and* ~1.96× taller line box at 375px,
dropping to 1.5× at 1440. Smaller text at a fixed measure also wraps less, so
the effect compounds at narrow widths and nearly vanishes at 1440.

| Page | 375 src→tgt | 768 src→tgt | 1440 src→tgt | 900 (no baseline) |
|---|---|---|---|---|
| disclosures | 4291→12513 **+8222** | 2324→6104 **+3780** | 2468→2914 +446 | 3640 |
| about-us | 957→1762 **+805** | 900→1476 **+576** | 900→1083 +183 | 1137 |
| zurich (×2) | 1059→1689 **+630** | 900→1547 **+647** | 988→1259 +271 | 1178 |
| policyholders | 1400→1710 +310 | 1179→1552 +373 | 1067→1077 +10 | 1068 |
| agentbrokers | 1468→1744 +276 | 1229→1552 +323 | 1117→1077 −40 | 1068 |
| home | 900→900 +0~ | 900→900 +0~ | 900→900 +0~ | 594 |

`disclosures` is the extreme case only because it is a wall of body copy — it is
the same 12px→22px ratio acting on the most text. At 1440 it is +18%.

## Decisions needed — human gate

**D6. Chrome content is hard-coded, and shared.** `header.js` and `footer.js`
carry the nav tree and footer links in JS constants, not in `/nav` and `/footer`
documents. Consequences to accept or reject before upload:
- authors cannot edit navigation or footer after upload;
- both blocks are **shared by every page in this repo**, so this styling is not
  scoped to the migrated site. Per the stage's own rule, if the target's chrome
  is meant to differ, it should sit behind a site theme class rather than being
  edited in place;
- the footer still reads **© 2014**, carried over from the source.

**D7. Fixed-width card vs full-bleed.** The source is a ~965px centred column on
a pale blue page background with a drop shadow. The target is full-bleed white.
Visible on every page and the single largest identity difference.

**D8. 768px disagrees by construction.** At 768 the source still shows the hero
sidebar *beside* the banner; the target stacks it above, because the project
switches at 900. Both are internally consistent — this is the disjoint-breakpoint
gap, and it needs a decision, not a fix: either move the project's hero
breakpoint below 768 or accept the deviation.

**D2 (carried, now measured).** `/about-us` is the worst-looking page. The
columns render **50/50 instead of the source's 3/9**, and `columns.css` sets
`align-items: center`, so "Newsroom" floats to the vertical middle of a mostly
empty left half. See `pages/about-us/assembled-1440.png`.

**Carried from `report.md`, confirmed visually:** promoted `h1` renders large
bold sans against the source's light grey serif with a full-width rule; body copy
uses the full section width where the source indents it under the 9-col banner;
the header's active-trail submenu row is absent.

## Not verified here

Pixel-level screenshot diffing was not run. With a 1.5–1.8× type scale
difference and Roboto substituted for Helvetica, a pixel diff is ~100% different
on every page and tells you nothing. Screenshot pairs are on disk for side-by-side
review instead:
`capture/<slug>/screenshots/<w>.png` vs `.eds-migration/pages/<slug>/assembled-<w>.png`.

## Assets

`manifest.json` lists 23; only 1 was on disk. All 23 are now in `drafts/assets/`
(22 downloaded, 0 failures). Drafts keep their absolute source URLs deliberately —
that is how the importer locates binaries — so `assemble.mjs` rewrites them to the
local copies at render time and asserts that none are left unmapped. The run
therefore does not depend on the source host being reachable.

## Reproducing

```bash
npx @adobe/aem-cli up --no-open            # in another shell
PLAYWRIGHT_PATH=/tmp/eds-crawl-tools/node_modules/playwright/index.mjs \
  node tools/importer/assemble.mjs         # SHOTS=1 to write screenshots
                                           # ONLY=home,policyholders to narrow
```
