/**
 * The default hero is CSS-only: it overlays the authored heading on a
 * full-bleed picture and needs no DOM changes, so decorate() leaves it
 * untouched. Only the `banner` variant restructures anything.
 *
 * `banner` reproduces the migrated Drupal `.content-banner-section` band —
 * a grey login panel beside the page banner image, with a four-colour rule
 * underneath.
 */

const STRIP_COLOURS = 4;

/**
 * Builds the decorative four-colour rule that sits under the banner band.
 * It carries no authored content, so it is generated rather than modelled.
 * @returns {HTMLDivElement} the strip element
 */
function buildStrip() {
  const strip = document.createElement('div');
  strip.className = 'hero-banner-strip';
  for (let i = 1; i <= STRIP_COLOURS; i += 1) {
    const segment = document.createElement('span');
    segment.className = `hero-banner-strip-segment hero-banner-strip-segment-${i}`;
    strip.append(segment);
  }
  return strip;
}

/**
 * Restructures the authored cells into the banner's two panes.
 *
 * Cell order is deliberately not treated as a contract. Universal Editor
 * delivers one row per model field group (image, then text) while document
 * authoring delivers one row whose cells are the author's columns, so the
 * panes are classified by content and placed by CSS `order`.
 *
 * The panes are re-parented onto the block itself because the block is the
 * grid container — wrapping them in a single row would leave the grid with
 * one child and collapse the split.
 *
 * @param {Element} block the hero block, already carrying the banner variant
 */
function decorateBanner(block) {
  const cells = [...block.querySelectorAll(':scope > div > div')];
  const panes = [];

  cells.forEach((cell) => {
    if (cell.querySelector('picture, img')) {
      cell.classList.add('hero-banner-media');
      panes.push(cell);
    } else if (cell.textContent.trim() || cell.children.length) {
      cell.classList.add('hero-banner-aside');
      panes.push(cell);
    }
    // An empty cell is dropped: the image is optional on some source pages,
    // and an empty pane would still claim its grid column and its padding.
  });

  if (!panes.length) return;

  block.replaceChildren(...panes, buildStrip());
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default function decorate(block) {
  if (block.classList.contains('banner')) decorateBanner(block);
}
