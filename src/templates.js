const site = require('./site');
const categories = require('./categories');

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const abs = (path) => (/^https?:\/\//.test(path) ? path : site.url + path);

const money = (n) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: site.currency, maximumFractionDigits: 0 }).format(n);

const productUrl = (p) => `/products/${p.slug}/`;
const productImage = (p) => p.image || `/assets/img/products/${p.art}.svg`;
const subUrl = (cat, sub) => `/${cat.slug}/${sub.slug}/`;
const findCategory = (slug) => categories.find((c) => c.slug === slug);
const findSub = (cat, slug) => cat.subs.find((s) => s.slug === slug);
const discount = (p) => (p.oldPrice ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100) : 0);

// The current catalog, set by build.js before rendering (the header needs counts).
let catalog = [];
const setCatalog = (list) => { catalog = list; };
const countIn = (subSlug) => catalog.filter((p) => p.sub === subSlug).length;

const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

// Orange farmhouse with a sprouting seedling.
const logoSvg = `<path d="M24 3.2 44.6 18.4c.9.7 1.4 1.7 1.4 2.8V40a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V21.2c0-1.1.5-2.1 1.4-2.8z" fill="#f56b13"/><path d="M24 11.5 37 21v15.5a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V21z" fill="#fff"/><path d="M24 39.5V27" stroke="#1b6b35" stroke-width="2.4" stroke-linecap="round"/><path d="M23.6 31.5c-5.8.2-9.2-3.3-9.4-8.6 5.4-.2 9 3 9.4 8.6z" fill="#4c9a3f"/><path d="M24.4 28.2c-.1-6 3.6-10 9.6-10.2.2 6-3.7 9.9-9.6 10.2z" fill="#1b6b35"/>`;
const logo = `<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true">${logoSvg}</svg>`;

// Stroke icons (24px grid). `svg(path)` wraps a path set.
const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;

const icons = {
  cart: svg('<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>'),
  cartPlus: svg('<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/><path d="M13.5 9.5v4M11.5 11.5h4"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: svg('<path d="M6 9l6 6 6-6"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>', ' stroke-width="2.4"'),
  truck: svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  wrench: svg('<path d="M14.5 5.5a4 4 0 0 0 5 5L12 18a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 1-2-2z"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>'),
  badge: svg('<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 21l5-3 5 3-1.5-7"/>'),
  drop: svg('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  pin: svg('<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>'),
  chevRight: svg('<path d="M9 6l6 6-6 6"/>', ' stroke-width="2.2"'),
  pulse: svg('<path d="M3 13h4l2.5-6 4 11 3-8 1.5 3H21"/>', ' stroke-width="2"'),
  headset: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.7-2 2.5-5 2.5"/>'),
  leaf: svg('<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path d="M5 19c3-5 6-8 10-10"/>'),
  tractor: svg('<circle cx="7" cy="16.5" r="3.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="M3.5 13.5V8h6.5l2 6.5h5.5l2 2M10 8V5M14 10h4v4"/>', ' stroke-width="2"'),
  tools: svg('<path d="M14.5 5.5a3.5 3.5 0 0 0 4.4 4.4L9 19.8a1.8 1.8 0 0 1-2.6-2.6l9.9-9.9a3.5 3.5 0 0 1-1.8-1.8z"/><path d="M4 4l6 6M3 7l4-4 3 3-4 4z"/>', ' stroke-width="2"'),
  sprayer: svg('<rect x="6" y="8" width="9" height="13" rx="3"/><path d="M8.5 8V5h4v3M15 11h3l3-3M9 13h3"/>', ' stroke-width="2"'),
  pump: svg('<path d="M12 3s5 5.5 5 9.2a5 5 0 0 1-10 0C7 8.5 12 3 12 3z"/><path d="M4 21h16M8 21v-3M16 21v-3"/>', ' stroke-width="2"'),
};

// Solid icons used on the hero benefit cards and badges.
const solid = {
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 3.5C11.6 3.2 4.8 8 4.4 16.6l-1.6 2.1a.9.9 0 1 0 1.4 1.1l1.5-2c8.4-.3 13.4-5.9 14.8-14.3zM8 16.3c1.8-3.3 4.4-5.8 8-7.6-2.8 2.3-4.8 4.8-6.3 7.8z"/></svg>',
  bars: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.5" height="8" rx="1.2" fill="currentColor"/><rect x="9.75" y="8.5" width="4.5" height="12.5" rx="1.2" fill="currentColor"/><rect x="16.5" y="3" width="4.5" height="18" rx="1.2" fill="currentColor"/></svg>',
  shieldCheck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6.2c0 5 3.4 9.6 8 10.8 4.6-1.2 8-5.8 8-10.8V5zm-1.2 13.6-3.6-3.6 1.4-1.4 2.2 2.2 4.8-4.8 1.4 1.4z"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5s7 7.7 7 12.6a7 7 0 0 1-14 0C5 10.2 12 2.5 12 2.5z"/><path d="M9 15.5a3 3 0 0 0 3 3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/></svg>',
  truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 6.5A1.5 1.5 0 0 1 3.5 5h10A1.5 1.5 0 0 1 15 6.5V9h3.2a2 2 0 0 1 1.6.8l2 2.7a1 1 0 0 1 .2.6V16a1 1 0 0 1-1 1h-1a2.8 2.8 0 0 0-5.6 0H9.6A2.8 2.8 0 0 0 4 17H3a1 1 0 0 1-1-1z"/><circle cx="6.8" cy="17.2" r="1.9" fill="currentColor"/><circle cx="17.2" cy="17.2" r="1.9" fill="currentColor"/></svg>',
};

Object.assign(icons, {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
});

// One icon per sub-category, used in the mega-menu and "shop by crop" tiles.
const subIcons = {
  'grain-moisture-meters': svg('<path d="M12 22V6"/><path d="M12 6c-2-1-2-3 0-4 2 1 2 3 0 4z"/><path d="M12 11c-3 0-4-2-4-4 3 0 4 2 4 4zM12 11c3 0 4-2 4-4-3 0-4 2-4 4z"/><path d="M12 16c-3 0-4-2-4-4 3 0 4 2 4 4zM12 16c3 0 4-2 4-4-3 0-4 2-4 4z"/>'),
  'hay-moisture-meters': svg('<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M3 12.5h18M8 7v11M16 7v11"/>'),
  'soil-moisture-meters': svg('<path d="M3 13h18M5 17h14M7 21h10"/><path d="M12 13V7m0 0c0-2.5-2-4-4.5-4C7.5 5.5 9.5 7 12 7zm0 0c0-2.5 2-4 4.5-4 0 2.5-2 4-4.5 4z"/>'),
  'wood-moisture-meters': svg('<ellipse cx="7" cy="12" rx="4" ry="5.5"/><path d="M7 6.5h10a4 5.5 0 0 1 0 11H7"/><ellipse cx="7" cy="12" rx="1.5" ry="2"/>'),
  'specialty-moisture-meters': svg('<ellipse cx="12" cy="12" rx="6" ry="8.5" transform="rotate(35 12 12)"/><path d="M8.5 6.5c3 3 4 8 7 11"/>'),
  'aqua-boy-moisture-meters': svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="7.5" y="5" width="9" height="6" rx="1"/><path d="M9.5 10l3-3"/><circle cx="9.5" cy="16" r="1.2"/><circle cx="14.5" cy="16" r="1.2"/>'),
  'building-moisture-meters': svg('<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>'),
  sprayers: svg('<rect x="6" y="7" width="9" height="14" rx="3"/><path d="M9 7V4h3v3M15 11h3l3-3"/>'),
  'water-pumps': svg('<path d="M12 3s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9 12 3 12 3z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>'),
  'processing-equipment': svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  'tillage-planting': svg('<circle cx="7" cy="17" r="3.5"/><circle cx="18" cy="18" r="2.5"/><path d="M3.5 14V8h7l2 6h6l1.5 2M10.5 8V4.5"/>'),
  'digging-tools': svg('<path d="M14 3l7 7M17.5 6.5L9 15"/><path d="M9 15l-5 5-1.5-1.5 5-5z" /><path d="M7 13l4 4"/>'),
  'cutting-tools': svg('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16L19 3M16 16L5 3"/>'),
  'carrying-tools': svg('<path d="M2 7h14l-3 7H5z"/><circle cx="17" cy="18" r="2.5"/><path d="M13 14l2.5 2.5M16 7l5-2"/>'),
  'testing-tools': svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'),
};
const subIcon = (slug) => subIcons[slug] || icons.drop;

function header(path) {
  const current = (href) => (path.startsWith(href) ? ' aria-current="page"' : '');
  const featured = catalog.find((p) => p.featured && p.image) || catalog.find((p) => p.featured);

  const mega = (cat, withFeature) => `
    <div class="mega" role="group" aria-label="${esc(cat.name)}">
      <div class="mega-links">
        ${cat.subs
          .map(
            (s) => `<a class="mega-link" href="${subUrl(cat, s)}"><span class="mega-ico">${subIcon(s.slug)}</span><span><b>${esc(s.name)}</b><small>${countIn(s.slug)} product${countIn(s.slug) === 1 ? '' : 's'}</small></span></a>`
          )
          .join('')}
        <a class="mega-all" href="/${cat.slug}/">Browse all ${esc(cat.name.toLowerCase())} ${icons.arrow}</a>
      </div>
      ${
        withFeature && featured
          ? `<a class="mega-feature" href="${productUrl(featured)}"><img src="${productImage(featured)}" alt="" width="240" height="180" loading="lazy"><span class="eyebrow">Featured</span><b>${esc(featured.name)}</b><span class="price">${money(featured.price)}</span></a>`
          : ''
      }
    </div>`;

  return `
<a class="skip" href="#main">Skip to content</a>
<div class="utility">
  <div class="container utility-inner">
    <p class="utility-left">
      <span>${solid.truck} Free shipping on orders over ${money(site.freeShippingOver)}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${icons.whatsapp} <span class="ua-label">Expert advice:</span> <a href="https://wa.me/${site.whatsapp}" rel="noopener">WhatsApp: ${site.phoneDisplay}</a></span>
    </p>
    <ul class="utility-right">
      <li>${solid.shieldCheck} Genuine Brands</li>
      <li>${solid.shieldCheck} 12-Month Warranty</li>
      <li>${solid.truck} Nationwide Delivery</li>
    </ul>
  </div>
</div>
<header class="site-header">
  <div class="container header-inner">
    <button class="nav-toggle" aria-controls="main-nav" aria-expanded="false" aria-label="Open menu">${icons.menu}</button>
    <a class="brand" href="/" aria-label="${site.name} home">${logo}<span class="brand-text"><span class="brand-name">U-farm</span><span class="brand-tag">Smarter Farming. Better Yields.</span></span></a>
    <nav class="main-nav" id="main-nav" aria-label="Main">
      <div class="nav-head"><span class="brand">${logo}<span class="brand-text"><span class="brand-name">U-farm</span></span></span><button class="nav-close" aria-label="Close menu">${icons.close}</button></div>
      <div class="nav-item"><a class="nav-link" href="/"${path === '/' ? ' aria-current="page"' : ''}>Home</a></div>
      ${categories
        .map(
          (c, i) => `<div class="nav-item has-mega">
        <a class="nav-link" href="/${c.slug}/"${current(`/${c.slug}/`)}>${esc(c.name)}<span class="nav-chev">${icons.chevron}</span></a>
        ${mega(c, i === 0)}
      </div>`
        )
        .join('')}
      <div class="nav-item"><a class="nav-link" href="/shop/"${current('/shop/')}>Shop All</a></div>
      <div class="nav-item"><a class="nav-link" href="/guides/"${current('/guides/')}>Guides</a></div>
      <div class="nav-item"><a class="nav-link" href="/contact/"${current('/contact/')}>Contact</a></div>
    </nav>
    <div class="header-actions">
      <form class="search-form" action="/search/" method="get" role="search">
        <label class="sr-only" for="q">Search products</label>
        <input id="q" name="q" type="search" placeholder="Search meters, tools…" autocomplete="off">
        <button type="submit" aria-label="Search">${icons.search}</button>
      </form>
      <a class="icon-link search-link" href="/search/" aria-label="Search">${icons.search}</a>
      <a class="icon-link cart-link" href="/cart/" aria-label="Cart">${icons.cart}<span class="cart-count" data-cart-count hidden>0</span></a>
    </div>
  </div>
</header>
<div class="nav-scrim" data-nav-scrim hidden></div>`;
}

function footer() {
  const a = site.address;
  return `
<section class="help-band">
  <div class="container help-inner">
    <div class="help-ico">${icons.whatsapp}</div>
    <div>
      <h2>Not sure which meter you need?</h2>
      <p>Tell us your crop and what you are measuring. We will recommend the right meter — usually within the hour.</p>
    </div>
    <a class="btn btn-wa btn-lg" href="https://wa.me/${site.whatsapp}" rel="noopener">${icons.whatsapp} Chat on WhatsApp</a>
  </div>
</section>
<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a class="brand" href="/">${logo}<span>U-farm</span></a>
      <p>${esc(site.description)}</p>
      <ul class="footer-contact">
        <li>${icons.whatsapp}<a href="https://wa.me/${site.whatsapp}" rel="noopener">${site.phoneDisplay}</a></li>
        <li>${icons.phone}<a href="tel:${site.phone}">${site.phoneDisplay}</a></li>
        <li>${icons.mail}<a href="mailto:${site.email}">${site.email}</a></li>
        <li>${icons.pin}<span>${esc(a.street)}, ${esc(a.city)}, ${esc(a.region)} ${esc(a.postalCode)}</span></li>
      </ul>
    </div>
    ${categories
      .map(
        (c) => `<div><h2>${esc(c.name)}</h2><ul>${c.subs
          .map((s) => `<li><a href="${subUrl(c, s)}">${esc(s.name)}</a></li>`)
          .join('')}</ul></div>`
      )
      .join('')}
    <div>
      <h2>Company</h2>
      <ul>
        <li><a href="/about/">About U-farm</a></li>
        <li><a href="/guides/">Buying guides</a></li>
        <li><a href="/shop/">Shop all</a></li>
        <li><a href="/shipping-returns/">Shipping &amp; returns</a></li>
        <li><a href="/privacy-policy/">Privacy policy</a></li>
        <li><a href="/contact/">Contact &amp; support</a></li>
      </ul>
    </div>
  </div>
  <div class="container footer-bottom">
    <p>&copy; ${new Date().getFullYear()} ${esc(site.legalName)}. All rights reserved.</p>
    <p class="social">
      <a href="${site.social.facebook}" rel="noopener">Facebook</a>
      <a href="${site.social.instagram}" rel="noopener">Instagram</a>
      <a href="${site.social.youtube}" rel="noopener">YouTube</a>
    </p>
  </div>
</footer>
<a class="wa-float" href="https://wa.me/${site.whatsapp}" rel="noopener" aria-label="Chat with U-farm on WhatsApp">${icons.whatsapp}</a>`;
}

function breadcrumbs(items) {
  // items: [{name, path}] — last item is the current page
  const html = `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items
    .map((it, i) =>
      i === items.length - 1
        ? `<li aria-current="page">${esc(it.name)}</li>`
        : `<li><a href="${it.path}">${esc(it.name)}</a></li>`
    )
    .join('')}</ol></nav>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
  return { html, ld };
}

// Google Analytics 4 (the Firebase Analytics property). Skipped on localhost so
// testing does not pollute your numbers.
const GA_ID = require('./firebase').config.measurementId;
const analytics = `<script>
if (!/^(localhost|127\\.|0\\.0\\.0\\.0)/.test(location.hostname)) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_ID}';
  document.head.appendChild(s);
}
</script>`;

function layout({ title, description, path, body, ld = [], ogType = 'website', image, noindex = false }) {
  const fullTitle = path === '/' ? title : `${title} | ${site.name}`;
  const img = abs(image && !image.endsWith('.svg') ? image : site.ogImage);
  return `<!doctype html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<link rel="canonical" href="${abs(path)}">
<meta name="theme-color" content="#0d502a">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${abs(path)}">
<meta property="og:image" content="${img}">
<meta property="og:locale" content="${site.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${img}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700;800&display=swap">
<link rel="stylesheet" href="/assets/css/style.css">
${ld.map(jsonLd).join('\n')}
${analytics}
</head>
<body>
${header(path)}
<main id="main">
${body}
</main>
${footer()}
<script src="/assets/js/main.js" defer></script>
</body>
</html>
`;
}

function productCard(p) {
  const cat = findCategory(p.category);
  const sub = findSub(cat, p.sub);
  const off = discount(p);
  const out = p.stock === 'OutOfStock';
  const tag = out
    ? '<span class="tag tag-out">Out of stock</span>'
    : p.stock === 'PreOrder'
      ? '<span class="tag tag-pre">Pre-order</span>'
      : off
        ? `<span class="tag tag-sale">-${off}%</span>`
        : '';
  return `
<article class="pcard" data-category="${p.category}" data-price="${p.price}" data-name="${esc(p.name)}">
  <a class="pcard-media" href="${productUrl(p)}" tabindex="-1" aria-hidden="true">
    <img src="${productImage(p)}" alt="${esc(p.name)}" width="400" height="300" loading="lazy" decoding="async">
    ${tag}
  </a>
  <div class="pcard-body">
    <p class="pcard-meta">${p.brand ? `<b>${esc(p.brand)}</b> · ` : ''}<a href="${subUrl(cat, sub)}">${esc(sub.name)}</a></p>
    <h3 class="pcard-title"><a href="${productUrl(p)}">${esc(p.name)}</a></h3>
    <p class="pcard-text">${esc(p.short)}</p>
    <div class="pcard-foot">
      <p class="price">${money(p.price)}${p.oldPrice ? ` <s>${money(p.oldPrice)}</s>` : ''}</p>
      <button class="icon-btn" data-add-to-cart="${p.slug}" aria-label="Add ${esc(p.name)} to cart"${out ? ' disabled' : ''}>${icons.cartPlus}</button>
    </div>
  </div>
</article>`;
}

const productGrid = (list) => `<div class="grid products">${list.map(productCard).join('')}</div>`;

module.exports = {
  esc,
  abs,
  money,
  discount,
  icons,
  solid,
  subIcon,
  logo,
  logoSvg,
  layout,
  breadcrumbs,
  productCard,
  productGrid,
  productUrl,
  productImage,
  subUrl,
  findCategory,
  findSub,
  setCatalog,
};
