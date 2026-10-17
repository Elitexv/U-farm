// U-farm server: serves the shop (dist/) and a password-protected admin panel
// at /admin for managing products. Every save rebuilds the site.
//
//   npm start                 → http://localhost:8080  (admin: /admin/)
//   PORT=3000 ADMIN_PASSWORD=… npm start
//
// The admin password comes from ADMIN_PASSWORD, or admin.config.json (created
// with a random password on first run).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { build } = require('./build');
const store = require('./src/products');
const categories = require('./src/categories');
const site = require('./src/site');
const { keys: artKeys } = require('./src/art');

const PORT = Number(process.env.PORT) || 8080;
const DIST = path.join(__dirname, 'dist');
const ADMIN_DIR = path.join(__dirname, 'admin');
const PUBLIC = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC, 'assets', 'img', 'products', 'uploads');
const UPLOAD_URL = '/assets/img/products/uploads/';
const MAX_BODY = 8 * 1024 * 1024; // JSON body incl. base64 image
const MAX_IMAGE = 5 * 1024 * 1024;
const SESSION_HOURS = 12;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// ---------- admin password ----------
function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const file = path.join(__dirname, 'admin.config.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).password;
  const password = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(file, JSON.stringify({ password }, null, 2) + '\n');
  console.log(`\nCreated admin.config.json — admin password: ${password}\n`);
  return password;
}
const PASSWORD = adminPassword();

// ---------- sessions & login throttling ----------
const sessions = new Map(); // token -> expiry ms
const failures = new Map(); // ip -> { count, until }

function sessionToken(req) {
  const m = /(?:^|;\s*)ufarm_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function isAuthed(req) {
  const t = sessionToken(req);
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(t);
    return false;
  }
  return true;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', ...extraHeaders });
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  const page = path.join(DIST, '404.html');
  res.writeHead(404, { 'Content-Type': TYPES['.html'] });
  if (fs.existsSync(page)) fs.createReadStream(page).pipe(res);
  else res.end('Not found');
}

const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- product validation ----------
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STOCK = ['InStock', 'PreOrder', 'OutOfStock'];
const IMAGE_PATH = /^\/assets\/img\/products\/[A-Za-z0-9/_.-]+\.(png|jpe?g|webp|svg)$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((s) => String(s).trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

function cleanProduct(input, { products, originalSlug }) {
  const p = {};
  // The slug is the page URL; it is fixed once created so links, Google
  // results and guide links never break.
  p.slug = originalSlug || str(input.slug, 80).toLowerCase();
  p.name = str(input.name, 120);
  if (!p.name) throw fail(400, 'Product name is required.');
  if (!SLUG.test(p.slug)) throw fail(400, 'URL slug may only use lowercase letters, numbers and single hyphens.');
  if (p.slug !== originalSlug && products.some((x) => x.slug === p.slug)) throw fail(409, `Another product already uses the slug "${p.slug}".`);

  const brand = str(input.brand, 60);
  if (brand) p.brand = brand;

  const cat = categories.find((c) => c.slug === input.category);
  if (!cat) throw fail(400, 'Choose a category.');
  if (!cat.subs.some((s) => s.slug === input.sub)) throw fail(400, 'Choose a sub-category.');
  p.category = cat.slug;
  p.sub = input.sub;

  p.sku = str(input.sku, 40);
  if (!p.sku) throw fail(400, 'SKU is required.');
  if (products.some((x) => x.sku.toLowerCase() === p.sku.toLowerCase() && x.slug !== originalSlug)) throw fail(409, `SKU ${p.sku} is already used by another product.`);

  p.price = Number(input.price);
  if (!Number.isFinite(p.price) || p.price < 0 || p.price > 1e10) throw fail(400, 'Enter a valid price.');
  if (input.oldPrice !== '' && input.oldPrice != null) {
    const old = Number(input.oldPrice);
    if (!Number.isFinite(old) || old <= p.price) throw fail(400, 'The "was" price must be higher than the price.');
    p.oldPrice = old;
  }

  const image = str(input.image, 200);
  if (image) {
    if (!IMAGE_PATH.test(image) || image.includes('..') || !fs.existsSync(path.join(PUBLIC, image))) throw fail(400, 'Product photo not found — upload it again.');
    p.image = image;
  } else {
    p.art = artKeys.includes(input.art) ? input.art : 'meter-cup';
  }

  if (input.featured) p.featured = true;
  p.stock = STOCK.includes(input.stock) ? input.stock : 'InStock';

  p.short = str(input.short, 300);
  if (!p.short) throw fail(400, 'A short description is required.');
  p.description = list(input.description, 10, 2000);
  if (!p.description.length) p.description = [p.short];
  p.features = list(input.features, 20, 200);
  p.specs = {};
  for (const [k, v] of Object.entries(input.specs && typeof input.specs === 'object' ? input.specs : {}).slice(0, 30)) {
    const key = str(k, 60);
    const val = str(String(v), 200);
    if (key && val) p.specs[key] = val;
  }
  p.uses = list(input.uses, 20, 60);
  return p;
}

// Remove an uploaded photo once no product uses it.
function cleanupUpload(imagePath, products) {
  if (!imagePath || !imagePath.startsWith(UPLOAD_URL)) return;
  if (products.some((p) => p.image === imagePath)) return;
  const file = path.join(PUBLIC, imagePath);
  if (file.startsWith(UPLOAD_DIR)) fs.rm(file, { force: true }, () => {});
}

// Saves run one at a time: `change` gets the current catalog and returns
// { next, result }. Then rebuild, rolling the catalog back if the build fails.
let busy = Promise.resolve();
function commit(change) {
  const run = busy.then(() => {
    const previous = store.load();
    const { next, result } = change(previous);
    store.save(next);
    try {
      build();
    } catch (err) {
      store.save(previous);
      try { build(); } catch { /* keep the last good dist */ }
      throw fail(500, `Publishing failed, changes were not saved: ${err.message}`);
    }
    return { next, result };
  });
  busy = run.catch(() => {});
  return run;
}

// ---------- image upload ----------
function detectImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function saveUpload({ name, data }) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) throw fail(400, 'Upload must be an image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE) throw fail(413, 'Image is larger than 5 MB.');
  const ext = detectImage(buf);
  if (!ext) throw fail(400, 'Only PNG, JPG and WebP images are allowed.');
  const base = String(name || 'product').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'product';
  const file = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  // Make it viewable straight away, before the next publish.
  const live = path.join(DIST, 'assets', 'img', 'products', 'uploads');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, file), buf);
  return UPLOAD_URL + file;
}

// ---------- admin API ----------
async function adminApi(req, res, route) {
  const ip = req.socket.remoteAddress;

  if (route === 'login' && req.method === 'POST') {
    const f = failures.get(ip);
    if (f && f.until > Date.now()) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const { password } = await readJson(req);
    if (!safeEqual(password || '', PASSWORD)) {
      const count = (f && f.until > Date.now() - 60000 ? f.count : 0) + 1;
      failures.set(ip, { count, until: count >= 5 ? Date.now() + 60000 : 0 });
      throw fail(401, 'Wrong password.');
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `ufarm_admin=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_HOURS * 3600}${secure}`,
    });
  }

  if (!isAuthed(req)) throw fail(401, 'Please log in.');
  // Simple CSRF guard on top of SameSite cookies: browsers will not send this
  // custom header cross-site without a CORS preflight, which we never allow.
  if (req.method !== 'GET' && req.headers['x-ufarm-admin'] !== '1') throw fail(403, 'Forbidden');

  if (route === 'logout' && req.method === 'POST') {
    sessions.delete(sessionToken(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'ufarm_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0' });
  }

  if (route === 'session') return send(res, 200, { ok: true });

  if (route === 'meta') {
    return send(res, 200, {
      currency: site.currency,
      currencySymbol: site.currencySymbol,
      artKeys,
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, subs: c.subs.map((s) => ({ slug: s.slug, name: s.name })) })),
    });
  }

  if (route === 'products' && req.method === 'GET') return send(res, 200, store.load());

  if (route === 'products' && req.method === 'POST') {
    const input = await readJson(req);
    const { result } = await commit((products) => {
      const product = cleanProduct(input, { products, originalSlug: null });
      return { next: [product, ...products], result: product };
    });
    return send(res, 201, result);
  }

  const m = /^products\/([a-z0-9-]+)$/.exec(route);
  if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
    const input = req.method === 'PUT' ? await readJson(req) : null;
    const { next, result } = await commit((products) => {
      const idx = products.findIndex((p) => p.slug === m[1]);
      if (idx === -1) throw fail(404, 'Product not found.');
      const old = products[idx];
      if (!input) return { next: products.filter((_, i) => i !== idx), result: { old } };
      const product = cleanProduct(input, { products, originalSlug: old.slug });
      return { next: products.map((p, i) => (i === idx ? product : p)), result: { old, product } };
    });
    if (!result.product || result.old.image !== result.product.image) cleanupUpload(result.old.image, next);
    return send(res, 200, result.product || { ok: true });
  }

  if (route === 'upload' && req.method === 'POST') {
    return send(res, 201, { image: saveUpload(await readJson(req)) });
  }

  throw fail(404, 'Unknown admin route.');
}

// ---------- server ----------
const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  // Admin API
  if (pathname.startsWith('/admin/api/')) {
    try {
      await adminApi(req, res, pathname.slice('/admin/api/'.length));
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' }, NO_INDEX);
    }
    return;
  }

  // Admin UI (static files in /admin)
  if (pathname === '/admin') return send(res, 301, '', { Location: '/admin/' });
  if (pathname.startsWith('/admin/')) {
    const file = path.normalize(path.join(ADMIN_DIR, pathname.slice('/admin/'.length) || 'index.html'));
    if (!file.startsWith(ADMIN_DIR)) return send(res, 403, 'Forbidden');
    return serveFile(res, file, NO_INDEX);
  }

  // Public site
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith('/')) return send(res, 301, '', { Location: pathname + '/' });
      file = path.join(file, 'index.html');
    }
    serveFile(res, file);
  });
});

console.log(`Building site… ${build()} pages`);
server.listen(PORT, () => {
  console.log(`U-farm shop:   http://localhost:${PORT}/`);
  console.log(`U-farm admin:  http://localhost:${PORT}/admin/`);
});
