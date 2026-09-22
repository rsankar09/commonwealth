/**
 * Hard-coded site footer.
 *
 * Content is not authored in AEM yet, so it lives here rather than in a
 * /footer fragment document. Swapping back later means replacing buildFooter()
 * with a loadFragment() call - footer.css works off the same DOM either way.
 */
const FOOTER_LINKS = [
  { label: 'Disclosures', href: '/disclosures' },
  {
    label: 'Privacy Policy',
    href: 'https://gafg.widen.net/s/dtgmv9vqtv/privacy_statement',
    external: true,
  },
];

const COPYRIGHT = '© Copyright 2014, Commonwealth Annuity and Life Insurance Company. All rights reserved.';

/**
 * Builds the footer DOM.
 * @returns {DocumentFragment} the link list and the copyright line
 */
function buildFooter() {
  const frag = document.createDocumentFragment();

  // authored as a list rather than literal '|' characters so the separators
  // are presentational and screen readers announce discrete links
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Footer');
  const ul = document.createElement('ul');
  ul.className = 'footer-links';
  FOOTER_LINKS.forEach(({ label, href, external }) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    li.append(a);
    ul.append(li);
  });
  nav.append(ul);

  const copy = document.createElement('p');
  copy.className = 'footer-copyright';
  copy.textContent = COPYRIGHT;

  frag.append(nav, copy);
  return frag;
}

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  block.textContent = '';
  const footer = document.createElement('div');
  footer.append(buildFooter());
  block.append(footer);
}
