# Capture bundle — commonwealth.globalatlantic.com

Self-contained crawl of the legacy Drupal 10 site, for the EDS migration.
Downstream skills (`eds-component-detect`, mapping review, QA) read from here
instead of re-fetching the live site. **Do not delete the screenshots or DOM.**

Crawled: 2026-09-21 · Breakpoints: 375 / 768 / 1440 · 23 pages captured, 0 failed.

## Layout

```
capture/
  README.md
  urls.json            # crawl input: slug → path, node id, template hint
  url-inventory.json   # canonical ↔ alias map, orphans, access-denied (redirect planning)
  crawl-report.json    # per-page outcome + skipped pages
  capture.mjs          # the crawler (re-runnable)
  <page-slug>/
    meta.json          # url, title, node id, crawled_at, breakpoints, image health,
                       # js errors, failed requests, truncated flag, notes
    dom.json           # { html } — serialized at 1440
    styles.json        # [ { selector_path, tag, classes, computed, rect } ]
    screenshots/375.png 768.png 1440.png   # full-page
```

`dom-by-breakpoint.json` is written only for pages with responsive markup swaps
(`<picture>` / `source[media]`). No page on this site triggered it — the theme
is a fixed-width Drupal layout with no art direction.

## Re-running

Playwright is intentionally **not** a project dependency (EDS ships no build
step). It lives in a scratch dir:

```bash
mkdir -p /tmp/eds-crawl-tools && cd /tmp/eds-crawl-tools
npm init -y && npm i playwright && npx playwright install chromium

cd /path/to/commonwealth
PLAYWRIGHT_PATH=/tmp/eds-crawl-tools/node_modules/playwright/index.mjs \
  node capture/capture.mjs

# re-capture a subset (merges into crawl-report.json, does not truncate it)
PLAYWRIGHT_PATH=... ONLY=reinsurance-solutions,newsroom node capture/capture.mjs
```

## What the crawler handles

- **Consent banner** — OneTrust (`#onetrust-accept-btn-handler`) is dismissed
  before capture on every page, so it won't be misdetected as a component
  downstream. A post-dismiss check flags any banner still in the DOM.
- **Lazy content** — scroll-to-bottom pass, then image health is re-checked and
  the page re-scrolled once if any image is empty/unloaded.
- **Noise** — GA `google-analytics.com/g/collect` beacons abort on context
  close and appear in `failed_requests`. Benign; ignore them.

## Caveats for downstream steps

- **No sitemap exists.** The page set came from depth-4 BFS of the link graph
  plus a `/node/1..200` id probe. The probe is what found the orphans below —
  if new content appears, re-probe rather than trusting the link graph.
- **4 pages skipped** as Access denied (`/node/21`, `/81`, `/86`, `/91`) —
  unpublished or role-restricted. Not captured. Someone with Drupal admin
  access should confirm whether they hold content that must migrate.
- **3 test pages captured but flagged** (`test_content: true` in meta.json):
  `/node/71` "testing 1", `/node/76` "Test 2", `/node/161` "Drupal 9 Test".
  Almost certainly should NOT migrate — confirm, then drop.
- **1 real orphan**: `/node/101` "Newroom PDF files" — no path alias, unlinked.
  Needs a routing decision.
- **Triple-served URLs.** Every page also answers at `/node/<id>` and
  `/index.php/<alias>`, all returning 200 (not redirecting). The migration needs
  explicit redirects for both alternate forms — see `url-inventory.json`.
- **`/disclosures` is the outlier page** — ~10k chars of body text vs ~500 for
  everything else. Expect a long-form legal template, not the standard layout.
- No page was truncated (`"truncated": false` everywhere); no infinite scroll
  or pagination exists on this site.
