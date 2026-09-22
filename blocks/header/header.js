// media query match that indicates mobile/tablet width
const isDesktop = window.matchMedia('(min-width: 900px)');

/**
 * Hard-coded site chrome.
 *
 * The nav and footer are not authored in AEM yet, so their content lives here
 * rather than in /nav and /footer fragment documents. Both sections are
 * ordinary links, so swapping back to fragment-driven content later only means
 * replacing buildNav() with a loadFragment() call - the decoration below and
 * all of header.css work off the same DOM either way.
 */
const BRAND = {
  href: '/',
  logo: '/icons/logo.webp',
  alt: 'Commonwealth Annuity and Life Insurance Company',
};

// Both Policyholders and Agents/Brokers expose the same five companies, each
// under its own path prefix.
const COMPANIES = [
  ['Commonwealth Annuity', 'commonwealth-annuity.html'],
  ['First Allmerica', 'first-allmerica.html'],
  ['Zurich American/Protective Life', 'zurich-american-protective-life.html'],
  ['Fidelity Mutual', 'fidelity-mutual.html'],
  ['Transamerica', 'transamerica.html'],
];

const companyLinks = (base) => COMPANIES.map(([label, slug]) => ({ label, href: `${base}/${slug}` }));

const NAV_ITEMS = [
  { label: 'About Us', href: '/content/commonwealth/about-us.html' },
  { label: 'Reinsurance Solutions', href: '/content/commonwealth/reinsurance-solutions.html' },
  { label: 'Products', href: '/content/commonwealth/products.html' },
  { label: 'Policyholders', href: '/content/commonwealth/policyholders.html', children: companyLinks('/content/commonwealth/policyholders') },
  { label: 'Agents/Brokers', href: '/content/commonwealth/agentbrokers.html', children: companyLinks('/content/commonwealth/agentbrokers') },
  { label: 'Contact', href: '/content/commonwealth/contact-us.html' },
];

function closeOnEscape(e) {
  if (e.code === 'Escape') {
    const nav = document.getElementById('nav');
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections);
      navSectionExpanded.focus();
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections);
      nav.querySelector('button').focus();
    }
  }
}

function closeOnFocusLost(e) {
  const nav = e.currentTarget;
  if (!nav.contains(e.relatedTarget)) {
    const navSections = nav.querySelector('.nav-sections');
    if (!navSections) return;
    const navSectionExpanded = navSections.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections, false);
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections, false);
    }
  }
}

function openOnKeydown(e) {
  const focused = document.activeElement;
  const isNavDrop = focused.classList.contains('nav-drop');
  if (isNavDrop && (e.code === 'Enter' || e.code === 'Space')) {
    const dropExpanded = focused.getAttribute('aria-expanded') === 'true';
    // eslint-disable-next-line no-use-before-define
    toggleAllNavSections(focused.closest('.nav-sections'));
    focused.setAttribute('aria-expanded', dropExpanded ? 'false' : 'true');
  }
}

function focusNavSection() {
  document.activeElement.addEventListener('keydown', openOnKeydown);
}

/**
 * Toggles all nav sections
 * @param {Element} sections The container element
 * @param {Boolean} expanded Whether the element should be expanded or collapsed
 */
function toggleAllNavSections(sections, expanded = false) {
  if (!sections) return;
  sections.querySelectorAll('.nav-sections .default-content-wrapper > ul > li').forEach((section) => {
    section.setAttribute('aria-expanded', expanded);
  });
}

/**
 * Toggles the entire nav
 * @param {Element} nav The container element
 * @param {Element} navSections The nav sections within the container element
 * @param {*} forceExpanded Optional param to force nav expand behavior when not null
 */
function toggleMenu(nav, navSections, forceExpanded = null) {
  const expanded = forceExpanded !== null ? !forceExpanded : nav.getAttribute('aria-expanded') === 'true';
  const button = nav.querySelector('.nav-hamburger button');
  document.body.style.overflowY = (expanded || isDesktop.matches) ? '' : 'hidden';
  nav.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  toggleAllNavSections(navSections, expanded || isDesktop.matches ? 'false' : 'true');
  button.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  // enable nav dropdown keyboard accessibility
  if (navSections) {
    const navDrops = navSections.querySelectorAll('.nav-drop');
    if (isDesktop.matches) {
      navDrops.forEach((drop) => {
        if (!drop.hasAttribute('tabindex')) {
          drop.setAttribute('tabindex', 0);
          drop.addEventListener('focus', focusNavSection);
        }
      });
    } else {
      navDrops.forEach((drop) => {
        drop.removeAttribute('tabindex');
        drop.removeEventListener('focus', focusNavSection);
      });
    }
  }

  // enable menu collapse on escape keypress
  if (!expanded || isDesktop.matches) {
    // collapse menu on escape press
    window.addEventListener('keydown', closeOnEscape);
    // collapse menu on focus lost
    nav.addEventListener('focusout', closeOnFocusLost);
  } else {
    window.removeEventListener('keydown', closeOnEscape);
    nav.removeEventListener('focusout', closeOnFocusLost);
  }
}

/**
 * Builds a link, flagging it when it addresses the page currently being viewed.
 * @param {Object} item Nav item with label and href
 * @returns {HTMLAnchorElement} The link
 */
// function buildLink({ label, href }) {
//   const a = document.createElement('a');
//   a.href = href;
//   a.textContent = label;
//   // strip any trailing slash so '/products/' still matches '/products'
//   const current = window.location.pathname.replace(/\/$/, '') || '/';
//   if (href === current) a.setAttribute('aria-current', 'page');
//   return a;
// }

function buildLink({ label, href }) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;

  const normalize = path => {
    path = path.replace(/\/$/, '') || '/';

    if (path === '/') return '/index.html';

    return path.endsWith('.html') ? path : `${path}.html`;
  };

  const current = normalize(window.location.pathname);
  const target = normalize(new URL(a.href, window.location.origin).pathname);

  if (target === current) {
    a.setAttribute('aria-current', 'page');
  }

  return a;
}
/**
 * Builds the nav DOM in the same shape loadFragment() would have produced, so
 * the toggle/keyboard helpers and header.css need no special casing.
 * @returns {DocumentFragment} brand and sections wrappers
 */
function buildNav() {
  const frag = document.createDocumentFragment();

  const brand = document.createElement('div');
  brand.className = 'nav-brand';
  const brandWrapper = document.createElement('div');
  brandWrapper.className = 'default-content-wrapper';
  const brandP = document.createElement('p');
  const brandLink = document.createElement('a');
  brandLink.href = BRAND.href;
  brandLink.setAttribute('aria-label', BRAND.alt);
  const logo = document.createElement('img');
  logo.src = BRAND.logo;
  logo.alt = BRAND.alt;
  logo.width = 305;
  logo.height = 51;
  // the logo is the LCP candidate on every page, so it must not be lazy
  logo.loading = 'eager';
  brandLink.append(logo);
  brandP.append(brandLink);
  brandWrapper.append(brandP);
  brand.append(brandWrapper);

  const sections = document.createElement('div');
  sections.className = 'nav-sections';
  const sectionsWrapper = document.createElement('div');
  sectionsWrapper.className = 'default-content-wrapper';
  const ul = document.createElement('ul');
  NAV_ITEMS.forEach((item) => {
    const li = document.createElement('li');
    li.append(buildLink(item));
    if (item.children) {
      const subUl = document.createElement('ul');
      item.children.forEach((child) => {
        const subLi = document.createElement('li');
        subLi.append(buildLink(child));
        subUl.append(subLi);
      });
      li.append(subUl);
    }
    ul.append(li);
  });
  sectionsWrapper.append(ul);
  sections.append(sectionsWrapper);

  frag.append(brand, sections);
  return frag;
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  block.textContent = '';
  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.append(buildNav());

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    navSections.querySelectorAll(':scope .default-content-wrapper > ul > li').forEach((navSection) => {
      if (navSection.querySelector('ul')) navSection.classList.add('nav-drop');
      navSection.addEventListener('click', (e) => {
        // let clicks on the section's own links navigate instead of toggling
        if (e.target.closest('a') && !isDesktop.matches) return;
        if (isDesktop.matches) {
          const expanded = navSection.getAttribute('aria-expanded') === 'true';
          toggleAllNavSections(navSections);
          navSection.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        }
      });
    });
  }

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="Open navigation">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMenu(nav, navSections));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');
  // prevent mobile nav behavior on window resize
  toggleMenu(nav, navSections, isDesktop.matches);
  isDesktop.addEventListener('change', () => toggleMenu(nav, navSections, isDesktop.matches));

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);
}
