# Metadata Audit — commonwealth (rsankar09/commonwealth)

Date: 2026-09-21 · Branch: `main` · Source CMS: Drupal 10 (`commonwealth.globalatlantic.com`)

## Scope note: where this data came from

The query index was **not** usable for this audit:

| Endpoint | Result |
|---|---|
| `main--commonwealth--rsankar09.aem.live/query-index.json` | 404 |
| `main--commonwealth--rsankar09.aem.page/query-index.json` | 404 |
| `/sitemap.xml`, `/metadata.json`, `/index.plain.html` | 404 |

Nothing is published to either environment yet — the repo is a single "Initial commit" from the
xwalk boilerplate, and `fstab.yaml` still points at the **boilerplate's** AEM mountpoint
(`adobe-rnd/aem-boilerplate-xwalk`) rather than this project's own site. See Blocker B1.

The audit therefore used the two local sources of truth instead:

- `capture/<slug>/meta.json` + `capture/<slug>/dom.json` — 23 pages crawled from the live Drupal site, including full `<head>` markup.
- `drafts/imported/*.plain.html` — 30 EDS documents produced by the importer (20 pages + 10 fragments).

## Headline finding

**The source Drupal site has no SEO metadata at all.** Extracting every `<meta>` tag from all 23
captured pages yields exactly four distinct names, none of them SEO-relevant:

```
Generator  HandheldFriendly  MobileOptimized  viewport
```

No `description`. No `og:*`. No `twitter:*`. No `robots`. Only `<title>` and `<link rel="canonical">`
were present. The imported EDS documents carry **no Metadata table either**, so the migration
currently preserves 0% metadata coverage.

This is a greenfield metadata build, not a cleanup.

## Summary statistics

Across the 20 pages that were actually imported (excluding 10 fragments and 3 test nodes):

| Property | Coverage before | Coverage after this plan |
|---|---|---|
| `title` | 20 / 20 (100%) — but see defects below | 20 / 20 |
| `description` | **0 / 20 (0%)** | 20 / 20 |
| `image` (og:image) | **0 / 20 (0%)** | 20 / 20 via bulk defaults |
| `robots` | 0 / 20 — nothing excluded | 13 paths excluded via bulk |
| Duplicate titles | **10 pages / 5 collisions** | 0 |
| Duplicate descriptions | n/a (none existed) | 0 |

Title lengths before: 21–62 chars, median 29. **13 of 23 titles were under 30 characters**, i.e. far
below the 50–60 useful range, because every title was just a short label plus a brand suffix.

## Issues by severity

### Critical

**C1 — Five pairs of exact duplicate titles (10 pages).** The company detail pages are duplicated
across the two audiences and were given identical titles:

| Title (source) | Paths |
|---|---|
| `Commonwealth Annuity \| commonwealth` | `/policyholders/commonwealth-annuity`, `/agentbrokers/commonwealth-annuity` |
| `First Allmerica \| commonwealth` | `/policyholders/first-allmerica`, `/agentbrokers/first-allmerica` |
| `Zurich American/Protective Life \| commonwealth` | `/policyholders/zurich-american-protective-life`, `/agentbrokers/zurich-american-protective-life` |
| `Fidelity Mutual \| commonwealth` | `/policyholders/fidelity-mutual`, `/agentbrokers/fidelity-mutual` |
| `Transamerica \| commonwealth` | `/policyholders/transamerica`, `/agentbrokers/transamerica` |

The page bodies are also near-identical (same phone numbers, same addresses), so these are genuine
duplicate-content pairs, not just duplicate titles. Distinct titles and descriptions per audience are
in `page-metadata.tsv`; if the pairs are truly interchangeable, consider consolidating to one page
per company with a canonical instead.

**C2 — Zero descriptions site-wide.** With no `description`, EDS falls back to the first paragraph
with 10+ words. On these pages that paragraph is the login chrome — *"Please choose your login:
Policyholders Agents/Brokers"* — or *"Quick links: Policyholders Agents/Brokers"*. Every search and
social snippet would read as boilerplate navigation. This is why descriptions must be authored
rather than left to the fallback.

### High

**H1 — Fragments are indexable.** `helix-query.yaml` includes `/**` with only `/**.json` excluded,
so the 10 `/fragments/policy-prefix/*` and `/fragments/agent-prefix/*` documents will enter
`query-index.json` and, because `helix-sitemap.yaml` sources the sitemap from that index, land in
`sitemap.xml`. These are headless content fragments with no nav, no H1 and no standalone value.
Fixed two ways below: `robots: noindex` in the bulk sheet, plus an index exclude (R3).

**H2 — Orphan legacy Drupal node paths.** `/node/101` ("Newroom PDF files") was imported and is an
orphan — nothing links to it, and it duplicates `/newsroom`'s press-release list. `/node/71`,
`/node/76` and `/node/161` are flagged `test_content: true` in `capture/urls.json` and were correctly
**not** imported. `/node/**` gets `noindex` in the bulk sheet as a safety net.

**H3 — Zero og:image coverage.** Without `image`, EDS uses the first image on the page. Here that is
the hero banner, which is **701×215** — roughly 3.3:1, against the 1200×630 (1.91:1) that Facebook,
LinkedIn and X expect. Previews will be cropped or rejected. Needs explicit 1200×630 assets.

### Medium

**M1 — Homepage has no H1.** `drafts/imported/index.plain.html` contains no `<h1>`; the hero copy is
split across `WE ARE` / `WE DELIVER` paragraphs. Only page in the set with no H1. Since `title`
falls back to the first H1, the homepage has no fallback at all — an explicit title is mandatory.

**M2 — Title/H1 mismatch on `/disclosures`.** Source `<title>` is "Disclosures | commonwealth" but
the H1 is "Terms of Use". Reconciled to "Terms of Use & Disclosures | Commonwealth Annuity".

**M3 — Brand suffix is lowercase.** All 23 source titles end in `| commonwealth` — lowercase, and not
the legal entity name. The brand is "Commonwealth Annuity and Life Insurance Company" / "Commonwealth
Annuity".

**M4 — Typo in source title and H1.** `/node/101` reads "New**r**oom PDF files" (missing `s`) in both
the `<title>` and the imported H1. Corrected in the sheet; the H1 in
`drafts/imported/newsroom-pdf-files.plain.html` still needs fixing if the page is kept.

**M5 — Wrong hero image on a policyholder page.**
`drafts/imported/policyholders-transamerica.plain.html` uses
`Zurich%20American-Protective%20Life_0.jpg`. The Transamerica page is showing the Zurich image.
Content bug, but it would also become that page's og:image under the first-image fallback.

### Low

**L1 — No `/default-meta-image.png`.** EDS's last-resort og:image fallback. Adding one to the code
root guarantees no page ever unfurls imageless.

**L2 — Descriptions will need review for the two `*-prefix` fragment families** if they are ever
promoted to standalone pages. Not needed while they stay fragments.

## Deliverables

| File | Purpose |
|---|---|
| `metadata-bulk.tsv` | 7 pattern rules — paste into the root `metadata` sheet |
| `page-metadata.tsv` | 20 rows of per-page `title` + `description` |

### Why the split

Bulk metadata is for pattern-based defaults; per-page values belong on the page. Titles and
descriptions here must be **unique per page** (that is the fix for C1 and C2), so putting 20 rows of
them in the bulk sheet would just be per-page management in the wrong file. The bulk sheet carries
only what genuinely applies by pattern: og:image defaults and robots exclusions.

### Bulk sheet (7 rules, evaluated top to bottom)

| URL | image | robots |
|---|---|---|
| `/**` | `/default-meta-image.png` | |
| `/policyholders/**` | `/assets/og/policyholders-1200x630.png` | |
| `/agentbrokers/**` | `/assets/og/agents-brokers-1200x630.png` | |
| `/newsroom` | `/assets/og/newsroom-1200x630.png` | |
| `/fragments/**` | | `noindex, nofollow` |
| `/node/**` | | `noindex, nofollow` |
| `/drafts/**` | | `noindex, nofollow` |

Broad `/**` first, then section overrides, then the noindex rules. Only `image` and `robots` columns
are included — no other property applies by pattern on this site.

The three `/assets/og/*` files **do not exist yet** and must be produced at 1200×630 before the sheet
is published; until then those rows resolve to missing images, which is worse than the `/**` default.
Either create them or drop rows 2–4 and keep the single site-wide default.

### Considered and rejected: `title:suffix`

EDS supports a `title:suffix` column, which would let page titles stay short and append
`| Commonwealth Annuity` site-wide. Rejected here because five of the pages **are** named after the
brand — `/policyholders/commonwealth-annuity` would render "Commonwealth Annuity | Commonwealth
Annuity". Full hand-written titles avoid that. Worth revisiting if the company pages are ever
consolidated (C1).

### Validation of the proposed values

All 20 rows in `page-metadata.tsv` were checked programmatically:

- Titles: 42–56 chars (target 50–60, flag <20 or >70) — all pass, **all 20 unique**.
- Descriptions: 150–160 chars — all pass, **all 20 unique**.

## Recommended fixes beyond metadata

**R1 — Create the og:image assets.** Three 1200×630 PNGs at the paths above, or remove those rows.

**R2 — Add `/default-meta-image.png`** to the repo root (code root is served, so this works before
any content lands in AEM). Keep it optimized — it ships on every page unfurl.

**R3 — Exclude fragments from the query index.** In `helix-query.yaml`:

```yaml
    exclude:
      - '/**.json'
      - '/fragments/**'
      - '/drafts/**'
```

Defence in depth with the `noindex` rules — this keeps fragments out of `sitemap.xml` entirely rather
than listing them as noindex. I can apply this on request.

**R4 — Extend the page model.** `models/_page.json` exposes only Title, Description and Keywords to
Universal Editor authors. There is no field for `image` (og:image) or `robots`, so authors cannot
override the bulk defaults per page. Add an image field and a robots select if per-page control is
wanted. Note `keywords` is modelled but `<meta name="keywords">` carries no SEO weight — consider
`tags` (which EDS renders as `article:tag`) instead.

**R5 — Decide on `/node/101`.** Either give it a real slug (`/newsroom/press-releases`), merge it into
`/newsroom`, or drop it. Leaving a `/node/101` URL in an EDS site is a migration artifact.

**R6 — Fix the two content bugs** — M4 (typo in the H1) and M5 (wrong image) — in
`drafts/imported/` before the content is loaded into AEM.

## Blockers

**B1 — `fstab.yaml` points at the boilerplate, not this project.**

```yaml
url: "https://author-p130360-e1272151.adobeaemcloud.com/bin/franklin.delivery/adobe-rnd/aem-boilerplate-xwalk/main"
```

This is the upstream boilerplate's mountpoint. Until it points at this project's own AEM site path,
nothing resolves — which is why every endpoint 404s. **The metadata sheet cannot be published until
this is corrected**, because there is no content root to publish it into.

**B2 — No content in AEM yet.** The 20 pages exist only as local `drafts/imported/*.plain.html`. Both
sheets are ready to apply, but they need a content root first.

## How to apply (AEM-authored / Universal Editor)

This is an xwalk project — content lives in AEM, not Google Drive or SharePoint. Bulk metadata is
supported: per aem.live, the sheet is named `metadata` in "Document Authoring, Google Drive **or
AEM**".

1. Resolve B1 so `fstab.yaml` points at this project's AEM content root.
2. In the site's root content folder in AEM, create a spreadsheet named **`metadata`** (single sheet).
3. Paste `metadata-bulk.tsv`. Row 1 is the header: `URL`, `image`, `robots`.
4. Preview, then Publish the sheet via Sidekick. Changes are not live until published.
5. For the per-page values, open each page's properties in Universal Editor and set **Title** (`jcr:title`)
   and **Description** (`jcr:description`) from `page-metadata.tsv`. These override the bulk sheet.
6. Verify: `curl https://main--commonwealth--rsankar09.aem.live/metadata.json` should list the 7 rules,
   and spot-check `<meta>` tags on `/policyholders/transamerica` and `/agentbrokers/transamerica`
   to confirm the C1 duplicate titles are now distinct.

Precedence reminder: **page properties > folder sheet > bulk sheet.** The bulk sheet's `image` values
only apply to pages that do not set their own.
