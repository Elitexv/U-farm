// Static site generator for U-farm. Zero dependencies: `node build.js` → dist/
const fs = require('fs');
const path = require('path');

const site = require('./src/site');
const categories = require('./src/categories');
const store = require('./src/products');
const posts = require('./src/posts');
const { art, keys: artKeys } = require('./src/art');
const firebase = require('./src/firebase');
const t = require('./src/templates');

const {
  esc, abs, money, discount, icons, solid, subIcon, layout, breadcrumbs,
  productGrid, productUrl, productImage, subUrl, findCategory, findSub,
} = t;

const DIST = path.join(__dirname, 'dist');
// Set at the start of each build() run.
let OUT = DIST;
let products = [];
let today = '';
const sitemap = []; // {path, lastmod, priority}

// ---------- helpers ----------
function write(urlPath, html, { priority = 0.5, index = true, lastmod = today } = {}) {
  const file = urlPath.endsWith('/') ? path.join(OUT, urlPath, 'index.html') : path.join(OUT, urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (index) sitemap.push({ path: urlPath, lastmod, priority });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const countIn = (subSlug) => products.filter((p) => p.sub === subSlug).length;
const firstSentence = (s) => s.split('. ')[0].replace(/\.$/, '') + '.';
const readMins = (html) => Math.max(2, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).length / 200));

const organization = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': abs('/#organization'),
  name: site.name,
  legalName: site.legalName,
  url: abs('/'),
  logo: abs('/assets/img/logo.svg'),
  email: site.email,
  telephone: site.phone,
  sameAs: Object.values(site.social),
});

const faqLd = (faq) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

const itemListLd = (list) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(productUrl(p)), name: p.name })),
});

const sectionHead = (title, { eyebrow, href, linkText } = {}) => `
<div class="section-head">
  <div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2></div>
  ${href ? `<a class="link-arrow" href="${href}">${linkText || 'View all'} ${icons.arrow}</a>` : ''}
</div>`;

const faqHtml = (faq) => `
<section class="section">
  <div class="container faq-grid">
    <div>
      <p class="eyebrow">FAQ</p>
      <h2>Questions, answered</h2>
      <p class="muted">Still unsure? Our team replies on WhatsApp, usually within the hour.</p>
      <a class="btn btn-outline" href="https://wa.me/${site.whatsapp}" rel="noopener">${icons.whatsapp} Ask on WhatsApp</a>
    </div>
    <div class="faq">
      ${faq.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}${icons.chevron}</summary><p>${esc(f.a)}</p></details>`).join('')}
    </div>
  </div>
</section>`;

const subTiles = (cat, { exclude } = {}) => `
<div class="type-grid">
  ${cat.subs
    .filter((s) => s.slug !== exclude)
    .map(
      (s) => `<a class="type-tile" href="${subUrl(cat, s)}"><span class="type-ico">${subIcon(s.slug)}</span><span class="type-text"><span class="type-name">${esc(s.name)}</span><span class="type-count">${plural(countIn(s.slug), 'product')}</span></span></a>`
    )
    .join('')}
</div>`;

const toolbar = (withFilter) => `
<div class="toolbar">
  <p class="count" data-count></p>
  <div class="toolbar-controls">
    ${withFilter ? `<label><span class="sr-only">Category</span><select data-filter>
      <option value="">All categories</option>
      ${categories.map((c) => `<option value="${c.slug}">${esc(c.name)}</option>`).join('')}
    </select></label>` : ''}
    <label><span class="sr-only">Sort by</span><select data-sort>
      <option value="">Sort: Featured</option>
      <option value="price-asc">Price: low to high</option>
      <option value="price-desc">Price: high to low</option>
      <option value="name">Name A–Z</option>
    </select></label>
  </div>
</div>`;

const pageHero = ({ crumbs, title, lead, extra = '', narrow = false }) => `
<section class="page-hero">
  <div class="container${narrow ? ' narrow' : ''}">
    ${crumbs}
    <h1>${title}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ''}
    ${extra}
  </div>
</section>`;

function postCard(post) {
  return `
<article class="gcard">
  <div class="gcard-top"><span class="gcard-ico">${icons.book}</span><span>${readMins(post.body)} min read</span></div>
  <h3><a href="/guides/${post.slug}/">${esc(post.title)}</a></h3>
  <p>${esc(post.excerpt)}</p>
  <a class="link-arrow" href="/guides/${post.slug}/" tabindex="-1" aria-hidden="true">Read guide ${icons.arrow}</a>
</article>`;
}

const relatedGuides = (cat) => {
  const list = posts.filter((p) => p.related.some((slug) => products.find((x) => x.slug === slug)?.category === cat.slug));
  if (!list.length) return '';
  return `
<section class="section tint">
  <div class="container">
    ${sectionHead('Guides &amp; advice', { eyebrow: 'Learn', href: '/guides/', linkText: 'All guides' })}
    <div class="grid guides">${list.map(postCard).join('')}</div>
  </div>
</section>`;
};

const formatDate = (d) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const promises = () => `
<ul class="promise-list">
  <li>${icons.truck}<span><b>Nationwide delivery</b> Free on orders over ${money(site.freeShippingOver)}</span></li>
  <li>${icons.shield}<span><b>Genuine &amp; under warranty</b> Original brands, manufacturer-backed</span></li>
  <li>${icons.chat}<span><b>Expert advice</b> WhatsApp ${site.phoneDisplay}</span></li>
</ul>`;

// ---------- pages ----------
function home() {
  const mm = findCategory('moisture-meters');
  const featuredMeters = products.filter((p) => p.featured && p.category === 'moisture-meters').slice(0, 8);
  const featuredOther = products.filter((p) => p.featured && p.category !== 'moisture-meters').slice(0, 8);
  const aquaBoy = products.filter((p) => p.sub === 'aqua-boy-moisture-meters');
  const aquaHero = aquaBoy.find((p) => p.image) || aquaBoy[0];
  const aquaSub = findSub(mm, 'aqua-boy-moisture-meters');

  const strip = [
    { href: '/moisture-meters/', icon: solid.drop, tone: 'green', name: 'Moisture Meters', sub: 'Grain • Soil • Hay • Wood' },
    { href: '/farm-equipment/', icon: icons.tractor, tone: 'orange', name: 'Farm Equipment', sub: 'Tillers • Shellers • Planters' },
    { href: '/farm-tools/', icon: icons.tools, tone: 'lime', name: 'Farm Tools', sub: 'Hoes • Pruners • Wheelbarrows' },
    { href: '/farm-equipment/sprayers/', icon: icons.sprayer, tone: 'blue', name: 'Sprayers', sub: 'Knapsack • Battery' },
    { href: '/farm-equipment/water-pumps/', icon: icons.pump, tone: 'purple', name: 'Pumps', sub: 'Petrol • Solar • Irrigation' },
  ];

  const body = `
<section class="hero">
  <span class="hero-shape" aria-hidden="true"></span>
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="hero-eyebrow"><span class="eyebrow-ico">${solid.leaf}</span>Every type of moisture meter, one store</p>
      <h1>Moisture Meters, Farm Equipment &amp; Tools That <span>Protect Your Harvest</span></h1>
      <p class="lead">Test grain, hay, soil, wood, coffee and more with accurate moisture meters — then get the sprayers, pumps and hand tools to do the work. Chosen for real farms, backed by real advice.</p>
      <div class="cta-row">
        <a class="btn btn-primary btn-lg" href="/moisture-meters/">${icons.cart} Shop Moisture Meters ${icons.chevRight}</a>
        <a class="btn btn-outline-green btn-lg" href="/guides/how-to-choose-a-moisture-meter/">${icons.pulse} Which meter do I need?</a>
      </div>
      <ul class="hero-checks">
        <li>${solid.checkCircle} ±0.5% grain accuracy</li>
        <li>${solid.checkCircle} 12-month warranty</li>
        <li>${solid.checkCircle} Free shipping over ${money(site.freeShippingOver)}</li>
      </ul>
    </div>
    <div class="hero-visual">
      <img class="hero-photo" src="/assets/img/hero-field-meter.jpg" alt="Digital grain moisture meter reading 14.5% in a field of young crops" width="572" height="498" fetchpriority="high">
      <ul class="benefits">
        <li>${solid.leaf}<span>Healthier<br>Crops</span></li>
        <li>${solid.bars}<span>Higher<br>Yields</span></li>
        <li>${solid.shieldCheck}<span>Greater<br>Profitability</span></li>
      </ul>
      <span class="leaf-deco" aria-hidden="true">${solid.leaf}</span>
    </div>
  </div>
</section>

<section class="cat-strip" aria-label="Shop by department">
  <div class="container strip-grid">
    ${strip
      .map(
        (s) => `<a class="strip-card" href="${s.href}"><span class="strip-ico tone-${s.tone}">${s.icon}</span><span class="strip-text"><b>${s.name}</b><small>${s.sub}</small></span><span class="strip-go">${icons.chevRight}</span></a>`
      )
      .join('')}
  </div>
</section>

<section class="why">
  <div class="container why-inner">
    <div class="why-head">
      <p class="eyebrow-line">Trusted by farmers, growers &amp; agribusinesses</p>
      <h2>Why Choose U-farm?</h2>
    </div>
    <ul class="why-list">
      <li>${icons.shield}<span><b>Quality Products</b><small>Only reliable brands</small></span></li>
      <li>${icons.headset}<span><b>Expert Support</b><small>Real farm advice</small></span></li>
      <li>${icons.truck}<span><b>Fast Delivery</b><small>Across Nigeria</small></span></li>
      <li>${icons.leaf}<span><b>Sustainable Farming</b><small>For a better tomorrow</small></span></li>
    </ul>
  </div>
  <span class="why-leaves" aria-hidden="true">${solid.leaf}${solid.leaf}</span>
</section>

<section class="section">
  <div class="container">
    ${sectionHead('Shop moisture meters by type', { eyebrow: 'Find your meter', href: '/moisture-meters/' })}
    ${subTiles(mm)}
  </div>
</section>

<section class="section tint">
  <div class="container">
    ${sectionHead('Best-selling moisture meters', { eyebrow: 'Popular now', href: '/moisture-meters/', linkText: 'All meters' })}
    ${productGrid(featuredMeters)}
  </div>
</section>

${aquaHero ? `
<section class="spotlight">
  <div class="container spotlight-grid">
    <div class="spotlight-copy">
      <p class="eyebrow light">Brand spotlight</p>
      <h2>Genuine Aqua-Boy by KPM, Germany</h2>
      <p>The analogue moisture meter cocoa buyers, coffee exporters and ginneries have trusted for decades. Each Aqua-Boy is factory-calibrated for one crop, so you read moisture straight off the scale.</p>
      <ul class="model-list">
        ${aquaBoy
          .map((p) => `<li><a href="${productUrl(p)}"><b>${esc(p.name.replace(/^Aqua-Boy\s+/, '').replace(/\s*\(.*\)$/, ''))}</b><span>${esc((p.specs['Measuring range'] || '').split(',')[0])}</span></a></li>`)
          .join('')}
      </ul>
      <a class="btn btn-light btn-lg" href="${subUrl(mm, aquaSub)}">Explore Aqua-Boy meters ${icons.arrow}</a>
    </div>
    <div class="spotlight-media"><img src="${productImage(aquaHero)}" alt="${esc(aquaHero.name)}" width="640" height="480" loading="lazy"></div>
  </div>
</section>` : ''}

${featuredOther.length ? `
<section class="section tint">
  <div class="container">
    ${sectionHead('Popular equipment &amp; tools', { eyebrow: 'Get the work done', href: '/shop/', linkText: 'Shop all' })}
    ${productGrid(featuredOther)}
  </div>
</section>` : ''}

<section class="section">
  <div class="container">
    ${sectionHead('Buying guides', { eyebrow: 'Learn', href: '/guides/', linkText: 'All guides' })}
    <div class="grid guides">${posts.map(postCard).join('')}</div>
  </div>
</section>`;

  const websiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: abs('/'),
    publisher: { '@id': abs('/#organization') },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: abs('/search/?q={search_term_string}') },
      'query-input': 'required name=search_term_string',
    },
  };

  write(
    '/',
    layout({
      title: `${site.name} — Moisture Meters, Farm Equipment & Tools`,
      description: site.description,
      path: '/',
      body,
      ld: [organization(), websiteLd],
    }),
    { priority: 1.0 }
  );
}

function categoryPage(cat) {
  const list = products.filter((p) => p.category === cat.slug);
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: cat.name, path: `/${cat.slug}/` },
  ]);
  const body = `
${pageHero({ crumbs: crumbs.html, title: esc(cat.title), lead: esc(cat.intro), extra: subTiles(cat) })}
<section class="section">
  <div class="container" data-listing>
    ${toolbar(false)}
    ${productGrid(list)}
  </div>
</section>
${relatedGuides(cat)}
${faqHtml(cat.faq)}`;

  write(
    `/${cat.slug}/`,
    layout({
      title: cat.title,
      description: cat.metaDescription,
      path: `/${cat.slug}/`,
      body,
      ld: [crumbs.ld, itemListLd(list), faqLd(cat.faq)],
    }),
    { priority: 0.9 }
  );
}

function subPage(cat, sub) {
  const list = products.filter((p) => p.sub === sub.slug);
  const p = subUrl(cat, sub);
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: cat.name, path: `/${cat.slug}/` },
    { name: sub.name, path: p },
  ]);
  const body = `
${pageHero({ crumbs: crumbs.html, title: esc(sub.title), lead: esc(sub.intro) })}
<section class="section">
  <div class="container" data-listing>
    ${toolbar(false)}
    ${list.length ? productGrid(list) : `<div class="empty-state">${icons.chat}<h2>New products coming soon</h2><p>Message us on WhatsApp for availability and prices.</p><a class="btn btn-wa" href="https://wa.me/${site.whatsapp}" rel="noopener">${icons.whatsapp} Ask on WhatsApp</a></div>`}
  </div>
</section>
${sub.faq ? faqHtml(sub.faq) : ''}
<section class="section tint">
  <div class="container">
    ${sectionHead(`More ${esc(cat.name.toLowerCase())}`, { href: `/${cat.slug}/`, linkText: `All ${esc(cat.name.toLowerCase())}` })}
    ${subTiles(cat, { exclude: sub.slug })}
  </div>
</section>`;

  write(
    p,
    layout({
      title: sub.title,
      description: sub.metaDescription,
      path: p,
      body,
      ld: [crumbs.ld, itemListLd(list), ...(sub.faq ? [faqLd(sub.faq)] : [])],
    }),
    { priority: 0.8 }
  );
}

function productPage(prod) {
  const cat = findCategory(prod.category);
  const sub = findSub(cat, prod.sub);
  const url = productUrl(prod);
  const img = productImage(prod);
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: cat.name, path: `/${cat.slug}/` },
    { name: sub.name, path: subUrl(cat, sub) },
    { name: prod.name, path: url },
  ]);
  const related = products
    .filter((p) => p.slug !== prod.slug && (p.sub === prod.sub || p.category === prod.category))
    .sort((a, b) => (b.sub === prod.sub) - (a.sub === prod.sub))
    .slice(0, 4);
  const guides = posts.filter((g) => g.related.includes(prod.slug));
  const buyable = prod.stock !== 'OutOfStock';
  const off = discount(prod);
  const stockText = {
    InStock: 'In stock — ships in 1–2 business days',
    PreOrder: 'Pre-order — we confirm delivery time on WhatsApp',
    OutOfStock: 'Out of stock — message us to be notified',
  }[prod.stock];
  const waText = encodeURIComponent(`Hello U-farm, I would like to order: ${prod.name} (${prod.sku}) — ${abs(url)}`);
  const specs = Object.entries(prod.specs);

  const body = `
<section class="product-top">
  <div class="container">
    ${crumbs.html}
    <div class="product-grid">
      <div class="product-gallery">
        <div class="gallery-frame">
          <img src="${img}" alt="${esc(prod.name)}" width="800" height="600" fetchpriority="high">
          ${off ? `<span class="tag tag-sale">-${off}%</span>` : ''}
        </div>
      </div>
      <div class="product-info">
        <p class="pcard-meta">${prod.brand ? `<b>${esc(prod.brand)}</b> · ` : ''}<a href="${subUrl(cat, sub)}">${esc(sub.name)}</a></p>
        <h1>${esc(prod.name)}</h1>
        <p class="sku">SKU ${esc(prod.sku)}</p>
        <div class="price-box">
          <p class="price price-lg">${money(prod.price)}${prod.oldPrice ? ` <s>${money(prod.oldPrice)}</s>` : ''}</p>
          ${prod.oldPrice ? `<span class="save">You save ${money(prod.oldPrice - prod.price)}</span>` : ''}
        </div>
        <p class="stock-pill ${prod.stock}"><span class="dot"></span>${stockText}</p>
        <p class="lead">${esc(prod.short)}</p>
        <div class="buy">
          <div class="stepper qty">
            <button type="button" data-qty-step="-1" aria-label="Decrease quantity">&minus;</button>
            <input id="qty" type="number" min="1" max="99" value="1" data-qty aria-label="Quantity">
            <button type="button" data-qty-step="1" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn btn-primary btn-lg" data-add-to-cart="${prod.slug}"${buyable ? '' : ' disabled'}>${icons.cart} Add to cart</button>
        </div>
        <a class="btn btn-wa btn-lg btn-block" href="https://wa.me/${site.whatsapp}?text=${waText}" rel="noopener">${icons.whatsapp} Order on WhatsApp</a>
        ${promises()}
      </div>
    </div>
  </div>
</section>

<section class="section tint">
  <div class="container detail-grid">
    <div class="detail-main">
      <nav class="detail-tabs" aria-label="Product details">
        <a href="#overview">Overview</a>
        ${prod.features.length ? '<a href="#features">Features</a>' : ''}
        ${specs.length ? '<a href="#specs">Specifications</a>' : ''}
      </nav>
      <section class="detail-card" id="overview">
        <h2>Overview</h2>
        ${prod.description.map((d) => `<p>${esc(d)}</p>`).join('')}
        ${prod.uses.length ? `<h3>Ideal for</h3><ul class="tags">${prod.uses.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
      </section>
      ${prod.features.length ? `
      <section class="detail-card" id="features">
        <h2>Key features</h2>
        <ul class="feature-list">${prod.features.map((f) => `<li>${icons.check}<span>${esc(f)}</span></li>`).join('')}</ul>
      </section>` : ''}
      ${specs.length ? `
      <section class="detail-card" id="specs">
        <h2>Specifications</h2>
        <table class="specs">
          <tbody>
            <tr><th scope="row">SKU</th><td>${esc(prod.sku)}</td></tr>
            ${specs.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>` : ''}
    </div>
    <aside class="detail-side">
      <div class="side-card help-card">
        <span class="help-ico">${icons.whatsapp}</span>
        <h3>Need help choosing?</h3>
        <p>Send us your crop and what you measure — we will confirm this is the right meter.</p>
        <a class="btn btn-wa btn-block" href="https://wa.me/${site.whatsapp}?text=${waText}" rel="noopener">Chat with an expert</a>
      </div>
      ${guides.length ? `<div class="side-card"><h3>Helpful guides</h3><ul class="side-links">${guides.map((g) => `<li><a href="/guides/${g.slug}/">${icons.book}<span>${esc(g.title)}</span></a></li>`).join('')}</ul></div>` : ''}
    </aside>
  </div>
</section>

${related.length ? `<section class="section"><div class="container">${sectionHead('You may also need', { href: subUrl(cat, sub), linkText: `More ${esc(sub.name.toLowerCase())}` })}${productGrid(related)}</div></section>` : ''}`;

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: prod.name,
    sku: prod.sku,
    mpn: prod.sku,
    image: [abs(img)],
    description: [prod.short, ...prod.description].join(' '),
    brand: { '@type': 'Brand', name: prod.brand || site.name },
    category: `${cat.name} > ${sub.name}`,
    url: abs(url),
    offers: {
      '@type': 'Offer',
      url: abs(url),
      priceCurrency: site.currency,
      price: prod.price.toFixed(2),
      priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
      availability: `https://schema.org/${prod.stock}`,
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': abs('/#organization') },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: site.address.country,
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 30,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
  };

  write(
    url,
    layout({
      title: prod.name.length > 34 ? prod.name : `${prod.name} — Buy Online`,
      description: `${prod.short} ${money(prod.price)}. In stock at U-farm.`.slice(0, 300),
      path: url,
      body,
      ld: [crumbs.ld, productLd],
      ogType: 'product',
      image: img,
    }),
    { priority: 0.7 }
  );
}

function shopPage() {
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: 'Shop All', path: '/shop/' },
  ]);
  const ordered = [...products].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  const body = `
${pageHero({ crumbs: crumbs.html, title: 'Shop All Moisture Meters, Farm Equipment &amp; Tools', lead: 'Browse the full U-farm range. Filter by department or sort by price.' })}
<section class="section">
  <div class="container" data-listing>
    ${toolbar(true)}
    ${productGrid(ordered)}
  </div>
</section>`;
  write(
    '/shop/',
    layout({
      title: 'Shop All Products',
      description: 'Shop the full U-farm range: grain, hay, soil and wood moisture meters, sprayers, water pumps, tillers and farm hand tools.',
      path: '/shop/',
      body,
      ld: [crumbs.ld, itemListLd(ordered)],
    }),
    { priority: 0.8 }
  );
}

function guidesIndex() {
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/guides/' },
  ]);
  const body = `
${pageHero({ crumbs: crumbs.html, title: 'Farm Buying Guides &amp; Moisture Advice', lead: 'Practical, plain-English guides to moisture testing, storage and choosing farm equipment.' })}
<section class="section">
  <div class="container"><div class="grid guides">${[...posts].reverse().map(postCard).join('')}</div></div>
</section>`;
  write(
    '/guides/',
    layout({
      title: 'Buying Guides & Moisture Advice',
      description: 'Guides to choosing moisture meters, safe grain storage moisture, hay baling moisture and farm equipment.',
      path: '/guides/',
      body,
      ld: [crumbs.ld],
    }),
    { priority: 0.7 }
  );
}

function postPage(post) {
  const url = `/guides/${post.slug}/`;
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/guides/' },
    { name: post.title, path: url },
  ]);
  const related = post.related.map((s) => products.find((p) => p.slug === s)).filter(Boolean);
  const body = `
<article>
  ${pageHero({
    crumbs: crumbs.html,
    title: esc(post.title),
    narrow: true,
    extra: `<p class="meta"><span class="author">${t.logo} U-farm team</span><span>${formatDate(post.date)}</span><span>${readMins(post.body)} min read</span></p>`,
  })}
  <section class="section">
    <div class="container narrow prose">${post.body}</div>
  </section>
</article>
${related.length ? `<section class="section tint"><div class="container">${sectionHead('Products in this guide', { eyebrow: 'Shop the guide' })}${productGrid(related)}</div></section>` : ''}`;
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: abs(url),
    author: { '@type': 'Organization', name: site.name, url: abs('/') },
    publisher: { '@id': abs('/#organization') },
  };
  write(
    url,
    layout({ title: post.title, description: post.metaDescription, path: url, body, ld: [crumbs.ld, articleLd], ogType: 'article' }),
    { priority: 0.6, lastmod: post.date }
  );
}

function simplePage({ path: p, title, h1, description, content, ld = [], index = true, wide = false, lead }) {
  const crumbs = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: title, path: p },
  ]);
  const body = `
${pageHero({ crumbs: crumbs.html, title: h1 || esc(title), lead, narrow: !wide })}
<section class="section">
  <div class="container${wide ? '' : ' narrow prose'}">${content}</div>
</section>`;
  write(p, layout({ title, description, path: p, body, ld: [crumbs.ld, ...ld], noindex: !index }), {
    priority: 0.4,
    index,
  });
}

function infoPages() {
  const a = site.address;
  simplePage({
    path: '/about/',
    title: 'About U-farm',
    lead: 'Helping farmers protect the value of every harvest.',
    description: 'U-farm supplies moisture meters, farm equipment and tools chosen for real farms, with honest advice and spare-parts support.',
    content: `
<p><strong>U-farm</strong> exists to help farmers protect the value of every harvest. We started with moisture meters — because a few percentage points of moisture decide whether grain stores safely, whether hay is safe to bale, and whether a crop sells at full price — and grew into a full range of farm equipment and hand tools.</p>
<h2>What we stand for</h2>
<ul>
  <li><strong>The right tool, not the most expensive one.</strong> We will tell you honestly what you need.</li>
  <li><strong>Equipment you can keep running.</strong> We stock spare parts for everything we sell.</li>
  <li><strong>Practical knowledge.</strong> Our <a href="/guides/">guides</a> share what we have learned from farmers, traders and agronomists.</li>
</ul>
<h2>Who we serve</h2>
<p>Smallholder and commercial farmers, grain traders and stores, cocoa and coffee buyers, cooperatives, hay producers, nurseries, sawmills and firewood sellers.</p>
<p><a class="btn btn-primary" href="/contact/">Talk to our team</a></p>`,
  });

  const localBusiness = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': abs('/#store'),
    name: site.name,
    url: abs('/'),
    image: abs('/assets/img/logo.svg'),
    telephone: site.phone,
    email: site.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: a.street,
      addressLocality: a.city,
      addressRegion: a.region,
      postalCode: a.postalCode,
      addressCountry: a.country,
    },
    openingHours: site.hours,
    parentOrganization: { '@id': abs('/#organization') },
  };

  simplePage({
    path: '/contact/',
    title: 'Contact U-farm',
    h1: 'Contact &amp; support',
    lead: 'Questions about a meter, a bulk quote or an order? We usually reply on WhatsApp within the hour, Monday to Saturday.',
    wide: true,
    description: `Contact U-farm for moisture meter advice, farm equipment quotes and orders. Call or WhatsApp ${site.phoneDisplay}, or email ${site.email}.`,
    ld: [localBusiness],
    content: `
<div class="contact-cards">
  <a class="contact-card wa" href="https://wa.me/${site.whatsapp}" rel="noopener">${icons.whatsapp}<b>WhatsApp</b><span>${site.phoneDisplay}</span><small>Fastest reply</small></a>
  <a class="contact-card" href="tel:${site.phone}">${icons.phone}<b>Call us</b><span>${site.phoneDisplay}</span><small>Mon–Sat, 8:00–18:00</small></a>
  <a class="contact-card" href="mailto:${site.email}">${icons.mail}<b>Support email</b><span>${site.email}</span><small>Reply within 1 business day</small></a>
  <div class="contact-card">${icons.pin}<b>Visit</b><span>${esc(a.street)}, ${esc(a.city)}</span><small>${esc(a.region)} ${esc(a.postalCode)}</small></div>
</div>
<div class="contact-layout">
  <div class="prose">
    <h2>Send us a message</h2>
    <p>Tell us what you grow or trade and what you need to measure. For bulk and cooperative orders, include quantities and your delivery town.</p>
    <ul>
      <li>Choosing the right moisture meter</li>
      <li>Quotes for farm equipment</li>
      <li>Spare parts, electrodes and warranty</li>
    </ul>
  </div>
  <form class="form card-form" data-contact-form>
    <div class="form-row">
      <label>Name <input name="name" required autocomplete="name"></label>
      <label>Phone (optional) <input name="phone" type="tel" autocomplete="tel"></label>
    </div>
    <label>Email <input name="email" type="email" required autocomplete="email"></label>
    <label>What can we help with?
      <select name="topic">
        <option>Choosing a moisture meter</option>
        <option>Farm equipment quote</option>
        <option>Bulk / cooperative order</option>
        <option>Spare parts or warranty</option>
        <option>Something else</option>
      </select>
    </label>
    <label>Message <textarea name="message" rows="5" required></textarea></label>
    <button class="btn btn-primary btn-lg" type="submit">Send message ${icons.arrow}</button>
    <p class="form-note" data-form-note hidden></p>
  </form>
</div>`,
  });

  simplePage({
    path: '/shipping-returns/',
    title: 'Shipping & Returns',
    description: `U-farm shipping times, free shipping over ${money(site.freeShippingOver)}, 30-day returns and warranty terms for moisture meters and farm equipment.`,
    content: `
<h2>Shipping</h2>
<ul>
  <li>In-stock orders ship within 1–2 business days.</li>
  <li>Free standard shipping on orders over ${money(site.freeShippingOver)}.</li>
  <li>Large equipment (pumps, tillers, shellers, chaff cutters) ships by freight — we will confirm the cost before dispatch.</li>
  <li>International delivery is available on request.</li>
</ul>
<h2>Returns</h2>
<p>Unused items in original packaging can be returned within 30 days of delivery for a full refund. Contact us first so we can arrange the return.</p>
<h2>Warranty</h2>
<ul>
  <li>Moisture meters, engines and motors: 12 months against manufacturing defects.</li>
  <li>Hand-operated equipment: 6 months.</li>
  <li>Normal wear parts (blades, nozzles, pins, probes, tyres) are not covered but are available as spares.</li>
</ul>`,
  });

  simplePage({
    path: '/privacy-policy/',
    title: 'Privacy Policy',
    description: 'How U-farm collects, uses and protects your personal information.',
    content: `
<p>We collect only the information needed to answer your questions and fulfil your orders: your name, contact details, delivery address and order details.</p>
<p>We never sell your information. We share it only with the delivery and payment providers needed to complete your order.</p>
<p>Your shopping cart is stored in your own browser and is not sent to us until you place an order.</p>
<p>To access or delete your information, email <a href="mailto:${site.email}">${site.email}</a>.</p>`,
  });

  // Utility pages — kept out of the index.
  simplePage({
    path: '/cart/',
    title: 'Your Cart',
    description: 'Your U-farm shopping cart.',
    index: false,
    wide: true,
    content: `<div data-cart><p>Loading your cart…</p></div>`,
  });
  simplePage({
    path: '/search/',
    title: 'Search',
    h1: 'Search products',
    description: 'Search U-farm moisture meters, farm equipment and tools.',
    index: false,
    wide: true,
    content: `
<form class="search-big" action="/search/" method="get" role="search">
  ${icons.search}
  <label class="sr-only" for="q-page">Search products</label>
  <input id="q-page" name="q" type="search" placeholder="Try “cocoa”, “Aqua-Boy”, “sprayer”…" autocomplete="off">
  <button class="btn btn-primary" type="submit">Search</button>
</form>
<div data-search-results></div>`,
  });

  // 404 (served at /404.html by most static hosts)
  const notFound = layout({
    title: 'Page Not Found',
    description: 'The page you were looking for could not be found.',
    path: '/404.html',
    noindex: true,
    body: `
<section class="section">
  <div class="container narrow empty-state">
    <p class="big-404">404</p>
    <h1>We could not find that page</h1>
    <p>It may have moved. Try one of these instead:</p>
    <div class="cta-row center">
      <a class="btn btn-primary" href="/moisture-meters/">Moisture meters</a>
      <a class="btn btn-outline" href="/shop/">Shop all</a>
    </div>
  </div>
</section>`,
  });
  write('/404.html', notFound, { index: false });
}

function extras() {
  // Product illustrations
  const imgDir = path.join(OUT, 'assets', 'img', 'products');
  fs.mkdirSync(imgDir, { recursive: true });
  for (const key of artKeys) fs.writeFileSync(path.join(imgDir, `${key}.svg`), art(key));

  // Search + cart index
  const index = products.map((p) => {
    const cat = findCategory(p.category);
    const sub = findSub(cat, p.sub);
    return {
      slug: p.slug,
      name: p.name,
      sku: p.sku,
      brand: p.brand || '',
      price: p.price,
      oldPrice: p.oldPrice || 0,
      stock: p.stock,
      url: productUrl(p),
      image: productImage(p),
      category: cat.name,
      sub: sub.name,
      subUrl: subUrl(cat, sub),
      short: p.short,
      keywords: [p.name, p.sku, p.brand || '', (p.brand || '').replace(/-/g, ''), cat.name, sub.name, p.short, ...p.uses]
        .join(' ')
        .toLowerCase(),
    };
  });
  fs.writeFileSync(
    path.join(OUT, 'products.json'),
    JSON.stringify({
      store: {
        name: site.name,
        currency: site.currency,
        whatsapp: site.whatsapp,
        email: site.email,
        freeShippingOver: site.freeShippingOver,
        paymentMethods: site.paymentMethods,
        // Lets checkout and the contact form save orders/messages to Firestore.
        firebase: { projectId: firebase.config.projectId, apiKey: firebase.config.apiKey },
      },
      products: index,
    })
  );

  // Starter catalog the admin can import into an empty Firestore.
  fs.mkdirSync(path.join(OUT, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'admin', 'seed.json'), JSON.stringify(store.load()));

  // Everything the admin panel needs to know about the site.
  fs.writeFileSync(
    path.join(OUT, 'admin', 'meta.json'),
    JSON.stringify({
      firebase: firebase.config,
      currency: site.currency,
      currencySymbol: site.currencySymbol,
      artKeys,
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, subs: c.subs.map((s) => ({ slug: s.slug, name: s.name })) })),
      siteDefaults: Object.fromEntries(Object.keys(SETTING_TYPES).map((k) => [k, site[k]])),
    })
  );

  // sitemap.xml
  const urls = sitemap
    .map(
      (u) =>
        `  <url><loc>${abs(u.path)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority.toFixed(1)}</priority></url>`
    )
    .join('\n');
  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );

  fs.writeFileSync(
    path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /cart/\nDisallow: /search/\nDisallow: /admin/\n\nSitemap: ${abs('/sitemap.xml')}\n`
  );

  fs.writeFileSync(
    path.join(OUT, 'site.webmanifest'),
    JSON.stringify(
      {
        name: `${site.name} — ${site.tagline}`,
        short_name: site.name,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#14532d',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      null,
      2
    )
  );
}

// ---------- data from Firestore ----------
// Settings the admin can change; anything else in settings/site is ignored.
const SETTING_TYPES = {
  phone: 'string', phoneDisplay: 'string', whatsapp: 'string', email: 'string',
  hours: 'string', freeShippingOver: 'number', paymentMethods: 'array', address: 'object', social: 'object',
};
function applySettings(remote) {
  for (const [key, type] of Object.entries(SETTING_TYPES)) {
    const v = remote[key];
    if (v == null || v === '') continue;
    if (type === 'array' ? Array.isArray(v) && v.length : typeof v === type) {
      site[key] = type === 'object' ? { ...site[key], ...v } : v;
    }
  }
  site.whatsapp = String(site.whatsapp).replace(/\D/g, '');
}

// Keep only well-formed products, so one bad document can't break the site.
function cleanRemote(docs) {
  const ok = [];
  for (const d of docs) {
    const cat = findCategory(d.category);
    const valid = d.name && d.sku && cat && findSub(cat, d.sub) && Number.isFinite(d.price) && d.short;
    if (!valid) { console.warn(`  skipped product "${d.id}": missing name, SKU, price, short description or category`); continue; }
    const { thumb, position, updatedAt, id, ...p } = d;
    p.slug = id;
    p.description = Array.isArray(p.description) && p.description.length ? p.description : [p.short];
    p.features = Array.isArray(p.features) ? p.features : [];
    p.uses = Array.isArray(p.uses) ? p.uses : [];
    p.specs = p.specs && typeof p.specs === 'object' ? p.specs : {};
    p.stock = ['InStock', 'PreOrder', 'OutOfStock'].includes(p.stock) ? p.stock : 'InStock';
    if (!p.image && !artKeys.includes(p.art)) p.art = 'meter-cup';
    ok.push({ ...p, _position: Number.isFinite(position) ? position : 0 });
  }
  return ok.sort((a, b) => a._position - b._position).map(({ _position, ...p }) => p);
}

let source = 'local';
async function loadCatalog() {
  try {
    const [remote, settings] = await Promise.all([firebase.getCollection('products'), firebase.getDoc('settings/site')]);
    if (settings) applySettings(settings);
    if (remote.length) {
      source = 'Firestore';
      return cleanRemote(remote);
    }
    console.warn('Firestore has no products yet — using src/data/products.json');
  } catch (err) {
    console.warn(`Could not read Firestore (${err.message}) — using src/data/products.json`);
  }
  source = 'local';
  return store.load();
}

// Photos uploaded in the admin live in Firestore (images/{id}) as data URLs.
// Write them out as normal files so pages, Google and social previews use plain URLs.
async function materializeImages(list) {
  const dir = path.join(OUT, 'assets', 'img', 'products', 'uploads');
  for (const p of list) {
    if (!p.image || !p.image.startsWith('fsimg:')) continue;
    const id = p.image.slice(6);
    try {
      const doc = await firebase.getDoc(`images/${encodeURIComponent(id)}`);
      const m = doc && /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(doc.data || '');
      if (!m) throw new Error('missing or not an image');
      const ext = { png: 'png', jpeg: 'jpg', webp: 'webp' }[m[1]];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.${ext}`), Buffer.from(m[2], 'base64'));
      p.image = `/assets/img/products/uploads/${id}.${ext}`;
    } catch (err) {
      console.warn(`  photo for "${p.slug}" unavailable (${err.message}); using an illustration`);
      delete p.image;
      p.art = p.art || 'meter-cup';
    }
  }
  return list;
}

// ---------- run ----------
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

// Builds into dist.tmp, then swaps it into place so a live server never
// serves a half-built site. Returns the number of indexable pages.
async function build() {
  const catalog = await loadCatalog();
  today = new Date().toISOString().slice(0, 10);
  sitemap.length = 0;
  OUT = DIST + '.tmp';
  rm(OUT);
  copyDir(path.join(__dirname, 'public'), OUT);
  products = await materializeImages(catalog);
  t.setCatalog(products);

  home();
  categories.forEach((c) => {
    categoryPage(c);
    c.subs.forEach((s) => subPage(c, s));
  });
  products.forEach(productPage);
  shopPage();
  guidesIndex();
  posts.forEach(postPage);
  infoPages();
  extras();

  rm(DIST);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(OUT, DIST);
      break;
    } catch (err) {
      // Windows can briefly lock a folder that is being read; retry.
      if (i >= 20) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  return sitemap.length;
}

module.exports = { build };

if (require.main === module) {
  build()
    .then((n) => console.log(`Built ${n} indexable pages from ${source} data (${products.length} products) into dist/`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
