/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/**
 * EDS site crawl — capture bundle generator.
 * Produces capture/<slug>/{meta.json,dom.json,styles.json,screenshots/*.png}
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Playwright is not a project dependency (EDS ships no build step). Resolve it
// from PLAYWRIGHT_PATH if provided, otherwise fall back to a normal resolve.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const ORIGIN = 'https://commonwealth.globalatlantic.com';
const OUT = path.dirname(new URL(import.meta.url).pathname);
const BREAKPOINTS = [375, 768, 1440];
const DESKTOP = 1440;

const allUrls = JSON.parse(readFileSync(path.join(OUT, 'urls.json'), 'utf8'));
// ONLY=slug-a,slug-b re-captures a subset (e.g. after a transient network failure).
const only = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const urls = only.length ? allUrls.filter((u) => only.includes(u.slug)) : allUrls;

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '.onetrust-close-btn-handler',
  '#truste-consent-button',
  'button#hs-eu-confirmation-button',
  '[aria-label="Accept cookies"]',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("Accept Cookies")',
  'button:has-text("I Accept")',
  'button:has-text("Got it")',
];

async function dismissConsent(page) {
  for (const sel of CONSENT_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return sel;
      }
    } catch { /* not present */ }
  }
  return null;
}

async function detectUndismissedBanner(page) {
  return page.evaluate(() => {
    const pats = /cookie|consent|gdpr|privacy.?banner|onetrust|truste/i;
    const nodes = [...document.querySelectorAll('div,section,aside,dialog')];
    return nodes.some((n) => {
      const id = `${n.id} ${n.className}`;
      if (!pats.test(typeof id === 'string' ? id : '')) return false;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return r.height > 40 && r.width > 200 && cs.display !== 'none'
        && cs.visibility !== 'hidden' && ['fixed', 'sticky'].includes(cs.position);
    });
  });
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight + 1000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 80);
    });
  });
  await page.waitForTimeout(500);
}

const STYLE_PROPS = [
  'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'text-transform', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display', 'position',
  'flex-direction', 'justify-content', 'align-items', 'gap', 'flex-wrap',
  'grid-template-columns', 'grid-template-rows',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-color', 'border-radius', 'box-shadow', 'max-width', 'width', 'height', 'overflow',
];

async function collectStyles(page, props) {
  return page.evaluate((PROPS) => {
    const selectorPath = (el) => {
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) { s += `#${cur.id}`; parts.unshift(s); break; }
        const cls = (typeof cur.className === 'string' ? cur.className : '')
          .trim().split(/\s+/).filter(Boolean).slice(0, 3);
        if (cls.length) s += `.${cls.join('.')}`;
        const parent = cur.parentElement;
        if (parent) {
          const sibs = [...parent.children].filter((c) => c.tagName === cur.tagName);
          if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        }
        parts.unshift(s);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    const targets = new Set();
    ['header', 'nav', 'footer'].forEach((t) => document.querySelectorAll(t).forEach((n) => targets.add(n)));
    const main = document.querySelector('main') || document.querySelector('#main-content')
      || document.querySelector('[role="main"]');
    if (main) {
      targets.add(main);
      [...main.children].forEach((c) => {
        targets.add(c);
        [...c.children].forEach((g) => targets.add(g));
      });
    }
    // Also capture first-level regions Drupal emits
    document.querySelectorAll('.region, .block, .layout-container > *').forEach((n) => targets.add(n));

    return [...targets].map((el) => {
      const cs = getComputedStyle(el);
      const computed = {};
      PROPS.forEach((p) => { computed[p] = cs.getPropertyValue(p); });
      const r = el.getBoundingClientRect();
      return {
        selector_path: selectorPath(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: (typeof el.className === 'string' ? el.className : '').trim() || null,
        computed,
        rect: {
          x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
          w: Math.round(r.width), h: Math.round(r.height),
        },
      };
    }).filter((s) => s.rect.w > 0 || s.rect.h > 0);
  }, props);
}

async function detectResponsiveSwap(page) {
  return page.evaluate(() => ({
    pictures: document.querySelectorAll('picture source').length,
    mediaAttrSources: document.querySelectorAll('source[media]').length,
    srcsetImgs: document.querySelectorAll('img[srcset]').length,
  }));
}

async function imageHealth(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return {
      total: imgs.length,
      emptySrc: imgs.filter((i) => !i.getAttribute('src')).length,
      placeholder: imgs.filter((i) => /data:image\/(gif|svg)/.test(i.getAttribute('src') || '')).length,
      notLoaded: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const report = [];

  for (const entry of urls) {
    const url = ORIGIN + entry.path;
    const dir = path.join(OUT, entry.slug);
    await mkdir(path.join(dir, 'screenshots'), { recursive: true });

    const ctx = await browser.newContext({
      viewport: { width: DESKTOP, height: 900 },
      deviceScaleFactor: 1,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/125.0 Safari/537.36 EDS-migration-crawler',
    });
    const page = await ctx.newPage();
    const jsErrors = [];
    const failedRequests = [];
    page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 300)));
    page.on('requestfailed', (r) => failedRequests.push({
      url: r.url().slice(0, 200), reason: r.failure()?.errorText,
    }));

    const rec = { slug: entry.slug, url, status: null, ok: false, notes: [] };

    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      rec.status = resp ? resp.status() : null;

      const consentHit = await dismissConsent(page);
      if (consentHit) rec.notes.push(`consent dismissed via ${consentHit}`);

      await autoScroll(page);

      let imgs = await imageHealth(page);
      if (imgs.emptySrc > 0 || imgs.notLoaded > 0) {
        await page.waitForTimeout(1500);
        await autoScroll(page);
        imgs = await imageHealth(page);
      }

      const bannerLeft = await detectUndismissedBanner(page);
      if (bannerLeft) rec.notes.push('possible undismissed cookie/consent banner still in DOM');

      const title = await page.title();
      const responsive = await detectResponsiveSwap(page);
      const bodyText = (await page.evaluate(() => (document.body.innerText || '').trim())).length;
      if (bodyText < 200) rec.notes.push(`thin body text (${bodyText} chars)`);
      if (/access denied|page not found|403|404/i.test(title)) rec.notes.push(`suspicious title: ${title}`);

      // DOM + styles at desktop
      await page.setViewportSize({ width: DESKTOP, height: 900 });
      await page.waitForTimeout(300);
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      await writeFile(path.join(dir, 'dom.json'), JSON.stringify({
        html, captured_at_breakpoint: DESKTOP,
      }, null, 2));

      const styles = await collectStyles(page, STYLE_PROPS);
      await writeFile(path.join(dir, 'styles.json'), JSON.stringify(styles, null, 2));

      // Screenshots per breakpoint
      const shots = {};
      for (const bp of BREAKPOINTS) {
        await page.setViewportSize({ width: bp, height: 900 });
        await page.waitForTimeout(500);
        await autoScroll(page);
        const file = path.join(dir, 'screenshots', `${bp}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shots[bp] = `screenshots/${bp}.png`;
      }

      // Per-breakpoint DOM only if responsive markup swaps detected
      const perBpDom = {};
      if (responsive.pictures > 0 || responsive.mediaAttrSources > 0) {
        for (const bp of BREAKPOINTS) {
          await page.setViewportSize({ width: bp, height: 900 });
          await page.waitForTimeout(400);
          perBpDom[bp] = await page.evaluate(() => document.documentElement.outerHTML);
        }
        await writeFile(path.join(dir, 'dom-by-breakpoint.json'), JSON.stringify(perBpDom, null, 2));
        rec.notes.push('responsive markup swap detected → per-breakpoint DOM captured');
      }

      await writeFile(path.join(dir, 'meta.json'), JSON.stringify({
        url,
        path: entry.path,
        slug: entry.slug,
        node_id: entry.node,
        template_hint: entry.template_hint,
        orphan: !!entry.orphan,
        test_content: !!entry.test_content,
        crawled_at: new Date().toISOString(),
        breakpoints: BREAKPOINTS,
        page_title: title,
        http_status: rec.status,
        truncated: false,
        source_cms: 'Drupal 10',
        screenshots: shots,
        images: imgs,
        responsive_markup: responsive,
        body_text_length: bodyText,
        js_errors: jsErrors,
        failed_requests: failedRequests.slice(0, 20),
        notes: rec.notes,
      }, null, 2));

      rec.ok = rec.status === 200;
      rec.title = title;
      rec.images = imgs;
      rec.jsErrors = jsErrors.length;
      console.log(`✓ ${entry.slug} [${rec.status}] "${title}" imgs=${imgs.total} err=${jsErrors.length} ${rec.notes.join('; ')}`);
    } catch (e) {
      rec.error = String(e.message).slice(0, 300);
      console.log(`✗ ${entry.slug} FAILED: ${rec.error}`);
    } finally {
      await ctx.close();
      report.push(rec);
    }
  }

  await browser.close();

  // When re-capturing a subset, merge into the existing report rather than truncate it.
  let merged = report;
  if (only.length) {
    try {
      const prev = JSON.parse(readFileSync(path.join(OUT, 'crawl-report.json'), 'utf8'));
      const bySlug = new Map((prev.results || []).map((r) => [r.slug, r]));
      report.forEach((r) => bySlug.set(r.slug, r));
      merged = allUrls.map((u) => bySlug.get(u.slug)).filter(Boolean);
    } catch { /* no prior report */ }
  }

  await writeFile(path.join(OUT, 'crawl-report.json'), JSON.stringify({
    origin: ORIGIN,
    crawled_at: new Date().toISOString(),
    breakpoints: BREAKPOINTS,
    pages_attempted: merged.length,
    pages_ok: merged.filter((r) => r.ok).length,
    skipped_auth_gated: [
      { path: '/node/21', reason: 'Access denied' },
      { path: '/node/81', reason: 'Access denied' },
      { path: '/node/86', reason: 'Access denied' },
      { path: '/node/91', reason: 'Access denied' },
    ],
    results: merged,
  }, null, 2));
  console.log(`\nDONE ${report.filter((r) => r.ok).length}/${urls.length}`);
})();
