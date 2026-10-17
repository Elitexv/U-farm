// U-farm admin panel — Firebase Auth + Firestore, hosted as a static page.
// Routes: #/ (products), #/new, #/edit/<slug>, #/orders, #/messages, #/settings
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const meta = await fetch('/admin/meta.json').then((r) => r.json());
const app = initializeApp(meta.firebase);
const auth = getAuth(app);
const db = getFirestore(app);

const state = { products: [], editing: null, dirty: false, slugTouched: false, photo: null, orders: [], messages: [] };
const STOCK = { InStock: 'In stock', PreOrder: 'Pre-order', OutOfStock: 'Out of stock' };
const ORDER_STATUS = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const MAX_IMAGE_BYTES = 700 * 1024; // keeps image documents well under Firestore's 1 MiB limit

// ---------- helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: meta.currency, maximumFractionDigits: 0 }).format(n || 0);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const when = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const imageOf = (p) => p.thumb || (p.image && !p.image.startsWith('fsimg:') ? p.image : `/assets/img/products/${p.art || 'meter-cup'}.svg`);
const catOf = (slug) => meta.categories.find((c) => c.slug === slug);
const subName = (cat, sub) => (catOf(cat)?.subs.find((s) => s.slug === sub) || {}).name || sub;
// Nigerian numbers written 0803… become 234803… for WhatsApp links.
const waNumber = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.startsWith('0') ? '234' + d.slice(1) : d; };

let toastTimer;
function toast(msg, isError) {
  const t = $('[data-toast]');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3500);
}
const friendly = (err) => {
  const code = err && err.code ? err.code : '';
  if (code === 'permission-denied') return 'Permission denied — check that the Firestore rules are published and your account is an admin.';
  if (code.startsWith('auth/')) return ({
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase Authentication.',
    'auth/configuration-not-found': 'Firebase Authentication is not set up yet. In the Firebase console open Authentication → Get started, then enable Email/Password.',
  })[code] || err.message;
  return err && err.message ? err.message : String(err);
};

function show(view) {
  $$('[data-view]').forEach((v) => { v.hidden = v.getAttribute('data-view') !== view; });
  const authed = !['login', 'denied', 'loading'].includes(view);
  $$('[data-authed]').forEach((el) => { el.hidden = !authed; });
  const tab = { list: 'products', edit: 'products' }[view] || view;
  $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-tab') === tab));
  window.scrollTo(0, 0);
}

// ---------- publishing (Vercel deploy hook) ----------
const PENDING_KEY = 'ufarm-admin-pending';
function markPending(on = true) {
  try { on ? localStorage.setItem(PENDING_KEY, '1') : localStorage.removeItem(PENDING_KEY); } catch {}
  $('[data-publish]').classList.toggle('pending', on);
}
$('[data-publish]').addEventListener('click', async () => {
  const btn = $('[data-publish]');
  try {
    const priv = await getDoc(doc(db, 'settings', 'private'));
    const hook = priv.exists() ? priv.data().deployHook : '';
    if (!hook) { toast('Add your Vercel deploy hook in Settings first.', true); location.hash = '#/settings'; return; }
    btn.disabled = true;
    // The hook is a cross-origin POST; no-cors still delivers it.
    await fetch(hook, { method: 'POST', mode: 'no-cors' });
    markPending(false);
    toast('Publishing… the website updates in about a minute.');
  } catch (err) {
    toast('Could not publish: ' + friendly(err), true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- auth ----------
$('[data-login]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('[data-login-error]');
  err.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    f.reset();
  } catch (x) {
    err.textContent = friendly(x);
    err.hidden = false;
  }
});
$('[data-reset]').addEventListener('click', async () => {
  const email = $('[data-login]').email.value.trim();
  if (!email) { toast('Type your email above first.', true); return; }
  try { await sendPasswordResetEmail(auth, email); toast('Password reset email sent.'); } catch (x) { toast(friendly(x), true); }
});
$$('[data-logout]').forEach((b) => b.addEventListener('click', () => signOut(auth)));
$('[data-copy-uid]').addEventListener('click', () => {
  navigator.clipboard.writeText($('[data-denied-uid]').textContent).then(() => toast('UID copied.'));
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { show('login'); return; }
  show('loading');
  try {
    const adminDoc = await getDoc(doc(db, 'admins', user.uid));
    if (!adminDoc.exists()) {
      $('[data-denied-email]').textContent = user.email;
      $('[data-denied-uid]').textContent = user.uid;
      show('denied');
      return;
    }
    await start();
  } catch (x) {
    toast(friendly(x), true);
    $('[data-denied-email]').textContent = user.email;
    $('[data-denied-uid]').textContent = user.uid;
    show('denied');
  }
});

// ---------- products: data ----------
async function loadProducts() {
  const snap = await getDocs(collection(db, 'products'));
  state.products = snap.docs
    .map((d) => ({ ...d.data(), slug: d.id }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function renderList() {
  const q = $('[data-search]').value.trim().toLowerCase();
  const cat = $('[data-filter-cat]').value;
  const stock = $('[data-filter-stock]').value;
  const rows = state.products.filter((p) => {
    if (cat && p.category !== cat) return false;
    if (stock && p.stock !== stock) return false;
    if (q && `${p.name} ${p.sku} ${p.brand || ''}`.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  $('[data-rows]').innerHTML = rows.map((p) => `<tr>
    <td><img class="thumb" src="${esc(imageOf(p))}" alt="" loading="lazy"></td>
    <td><a class="pname" href="#/edit/${esc(p.slug)}">${esc(p.name)}</a><div class="sub">${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''}</div></td>
    <td>${esc(catOf(p.category)?.name || p.category)}<div class="sub">${esc(subName(p.category, p.sub))}</div></td>
    <td class="num">${money(p.price)}${p.oldPrice ? `<div class="sub"><s>${money(p.oldPrice)}</s></div>` : ''}</td>
    <td><span class="pill ${esc(p.stock)}">${STOCK[p.stock] || esc(p.stock)}</span></td>
    <td><button type="button" class="star${p.featured ? ' on' : ''}" data-star="${esc(p.slug)}" aria-label="${p.featured ? 'Remove from' : 'Add to'} home page" title="Featured on home page">★</button></td>
    <td><div class="actions"><a href="#/edit/${esc(p.slug)}">Edit</a><a href="/products/${esc(p.slug)}/" target="_blank" rel="noopener">View</a></div></td>
  </tr>`).join('');
  $('[data-empty]').hidden = rows.length > 0 || state.products.length === 0;
  $('[data-empty-catalog]').hidden = state.products.length > 0;
  const out = state.products.filter((p) => p.stock === 'OutOfStock').length;
  const feat = state.products.filter((p) => p.featured).length;
  $('[data-stats]').textContent = `${state.products.length} products · ${feat} featured · ${out} out of stock`;
}
['[data-search]', '[data-filter-cat]', '[data-filter-stock]'].forEach((s) => $(s).addEventListener('input', renderList));

$('[data-rows]').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-star]');
  if (!btn) return;
  const p = state.products.find((x) => x.slug === btn.getAttribute('data-star'));
  btn.disabled = true;
  try {
    await updateDoc(doc(db, 'products', p.slug), { featured: !p.featured, updatedAt: serverTimestamp() });
    p.featured = !p.featured;
    markPending();
    renderList();
    toast(p.featured ? 'Now featured on the home page.' : 'Removed from the home page.');
  } catch (x) {
    toast(friendly(x), true);
    btn.disabled = false;
  }
});
$('[data-new]').addEventListener('click', () => { location.hash = '#/new'; });

// One-click import of the catalog that is currently on the website.
$('[data-import]').addEventListener('click', async () => {
  const btn = $('[data-import]');
  if (!confirm('Import the starter catalog into Firestore?')) return;
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const seed = await fetch('/admin/seed.json').then((r) => r.json());
    for (let i = 0; i < seed.length; i += 400) {
      const batch = writeBatch(db);
      seed.slice(i, i + 400).forEach((p, j) => {
        const { slug, ...data } = p;
        batch.set(doc(db, 'products', slug), { ...data, position: i + j, updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    await loadProducts();
    renderList();
    markPending();
    toast(`Imported ${seed.length} products.`);
  } catch (x) {
    toast(friendly(x), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import starter catalog';
  }
});

// ---------- editor ----------
const form = $('[data-editor]');

function fillSubs(catSlug, selected) {
  const c = catOf(catSlug) || meta.categories[0];
  form.sub.innerHTML = c.subs.map((s) => `<option value="${esc(s.slug)}"${s.slug === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

function setPhoto(photo) {
  // photo: null | { image, preview, thumb }
  state.photo = photo;
  const img = $('[data-photo-img]');
  if (photo) img.src = photo.preview;
  img.hidden = !photo;
  $('[data-photo-empty]').hidden = !!photo;
  $('[data-remove-photo]').hidden = !photo;
  $('[data-art-wrap]').hidden = !!photo;
}

async function openEditor(p) {
  state.editing = p || null;
  state.slugTouched = !!p;
  const isNew = !p;
  p = p || { stock: 'InStock', category: meta.categories[0].slug, art: 'meter-cup', specs: {}, description: [], features: [], uses: [] };

  $('[data-edit-title]').textContent = isNew ? 'Add product' : 'Edit product';
  form.reset();
  form.name.value = p.name || '';
  form.slug.value = p.slug || '';
  form.slug.readOnly = !isNew;
  $('[data-slug-hint]').textContent = isNew
    ? `Page address: /products/${p.slug || '…'}/ — cannot be changed later`
    : `Page address is fixed: /products/${p.slug}/`;
  form.sku.value = p.sku || '';
  form.brand.value = p.brand || '';
  form.category.value = p.category;
  fillSubs(p.category, p.sub);
  form.short.value = p.short || '';
  form.description.value = (p.description || []).join('\n\n');
  form.features.value = (p.features || []).join('\n');
  form.specs.value = Object.entries(p.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  form.uses.value = (p.uses || []).join('\n');
  form.art.value = p.art || 'meter-cup';
  form.price.value = p.price != null ? p.price : '';
  form.oldPrice.value = p.oldPrice || '';
  form.stock.value = p.stock || 'InStock';
  form.featured.checked = !!p.featured;
  updateShortCount();

  setPhoto(null);
  if (p.image) {
    if (p.image.startsWith('fsimg:')) {
      setPhoto({ image: p.image, preview: p.thumb || '', thumb: p.thumb || '' });
      getDoc(doc(db, 'images', p.image.slice(6))).then((d) => {
        if (d.exists() && state.photo && state.photo.image === p.image) { state.photo.preview = d.data().data; $('[data-photo-img]').src = d.data().data; }
      });
    } else {
      setPhoto({ image: p.image, preview: p.image, thumb: '' });
    }
  }

  const live = $('[data-view-live]');
  live.hidden = isNew;
  if (!isNew) live.href = `/products/${p.slug}/`;
  $('[data-delete]').hidden = isNew;
  $('[data-form-error]').hidden = true;
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $('[data-upload-status]').textContent = 'JPG, PNG or WebP. Photos are resized automatically.';
  state.dirty = false;
  show('edit');
  if (isNew) form.name.focus();
}

function updateShortCount() { $('[data-short-count]').textContent = `${form.short.value.length}/300`; }

form.addEventListener('input', (e) => {
  state.dirty = true;
  if (e.target === form.name && !state.slugTouched) form.slug.value = slugify(form.name.value);
  if (e.target === form.slug) { state.slugTouched = true; form.slug.value = form.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
  if ((e.target === form.name || e.target === form.slug) && !state.editing) {
    $('[data-slug-hint]').textContent = `Page address: /products/${form.slug.value || '…'}/ — cannot be changed later`;
  }
  if (e.target === form.short) updateShortCount();
  e.target.removeAttribute('aria-invalid');
});
form.category.addEventListener('change', () => fillSubs(form.category.value));

const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);

// Validates the form and returns a clean product object (or throws).
function collect() {
  const fail = (msg, field) => { if (field) form[field].setAttribute('aria-invalid', 'true'); throw new Error(msg); };
  const p = {};
  p.name = form.name.value.trim().slice(0, 120);
  if (!p.name) fail('Product name is required.', 'name');
  const slug = state.editing ? state.editing.slug : form.slug.value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('URL slug may only use lowercase letters, numbers and single hyphens.', 'slug');
  if (!state.editing && state.products.some((x) => x.slug === slug)) fail(`Another product already uses the slug "${slug}".`, 'slug');
  p.sku = form.sku.value.trim().slice(0, 40);
  if (!p.sku) fail('SKU is required.', 'sku');
  if (state.products.some((x) => x.sku.toLowerCase() === p.sku.toLowerCase() && x.slug !== slug)) fail(`SKU ${p.sku} is already used by another product.`, 'sku');
  const brand = form.brand.value.trim().slice(0, 60);
  if (brand) p.brand = brand;
  p.category = form.category.value;
  p.sub = form.sub.value;
  p.price = Number(form.price.value);
  if (form.price.value === '' || !Number.isFinite(p.price) || p.price < 0) fail('Enter a valid price.', 'price');
  if (form.oldPrice.value !== '') {
    const old = Number(form.oldPrice.value);
    if (!Number.isFinite(old) || old <= p.price) fail('The "was" price must be higher than the price.', 'oldPrice');
    p.oldPrice = old;
  }
  p.stock = form.stock.value;
  if (form.featured.checked) p.featured = true;
  p.short = form.short.value.trim().slice(0, 300);
  if (!p.short) fail('A short description is required.', 'short');
  p.description = form.description.value.split(/\n\s*\n/).map((s) => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).slice(0, 10);
  if (!p.description.length) p.description = [p.short];
  p.features = lines(form.features.value).slice(0, 20);
  p.specs = {};
  lines(form.specs.value).slice(0, 30).forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0) p.specs[line.slice(0, i).trim().slice(0, 60)] = line.slice(i + 1).trim().slice(0, 200);
  });
  p.uses = lines(form.uses.value).slice(0, 20);
  if (state.photo) {
    p.image = state.photo.image;
    if (state.photo.thumb) p.thumb = state.photo.thumb;
  } else {
    p.art = form.art.value || 'meter-cup';
  }
  return { slug, product: p };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-form-error]');
  err.hidden = true;
  let data;
  try { data = collect(); } catch (x) { err.textContent = x.message; err.hidden = false; return; }
  const btn = $('[data-save]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const old = state.editing;
    const position = old ? old.position ?? 0 : Math.min(0, ...state.products.map((x) => x.position ?? 0)) - 1;
    await setDoc(doc(db, 'products', data.slug), { ...data.product, position, updatedAt: serverTimestamp() });
    // Tidy up a replaced photo.
    if (old && old.image && old.image !== data.product.image) await removeImageIfUnused(old.image, data.slug);
    const saved = { ...data.product, slug: data.slug, position };
    const i = state.products.findIndex((x) => x.slug === data.slug);
    if (i === -1) state.products.unshift(saved); else state.products[i] = saved;
    state.dirty = false;
    markPending();
    toast(`${old ? 'Saved' : 'Added'}. Click Publish to update the website.`);
    location.hash = '#/';
  } catch (x) {
    err.textContent = friendly(x);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

async function removeImageIfUnused(image, exceptSlug) {
  if (!image || !image.startsWith('fsimg:')) return;
  if (state.products.some((x) => x.slug !== exceptSlug && x.image === image)) return;
  try { await deleteDoc(doc(db, 'images', image.slice(6))); } catch { /* not critical */ }
}

$('[data-delete]').addEventListener('click', async () => {
  const p = state.editing;
  if (!p || !confirm(`Delete "${p.name}"? Its page will be removed from the shop when you publish.`)) return;
  try {
    await deleteDoc(doc(db, 'products', p.slug));
    state.products = state.products.filter((x) => x.slug !== p.slug);
    await removeImageIfUnused(p.image, p.slug);
    state.dirty = false;
    markPending();
    toast('Product deleted. Click Publish to update the website.');
    location.hash = '#/';
  } catch (x) {
    toast(friendly(x), true);
  }
});
$('[data-back]').addEventListener('click', () => { location.hash = '#/'; });

// ---------- photo upload (resized in the browser, stored in Firestore) ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
    img.src = url;
  });
}
function encode(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // flatten transparency (JPEG fallback has no alpha)
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality); // older Safari
  return url;
}
const bytesOf = (dataUrl) => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

$('[data-file]').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('[data-upload-status]');
  status.textContent = 'Processing photo…';
  try {
    const img = await loadImage(file);
    let max = 1400, q = 0.85, data = encode(img, max, q);
    while (bytesOf(data) > MAX_IMAGE_BYTES && max > 600) { max -= 200; q -= 0.05; data = encode(img, max, q); }
    if (bytesOf(data) > MAX_IMAGE_BYTES) throw new Error('This photo is too detailed to store. Try a smaller image.');
    const thumb = encode(img, 200, 0.7);
    const id = `${slugify(form.slug.value || file.name.replace(/\.\w+$/, '')) || 'photo'}-${Date.now().toString(36)}`;
    status.textContent = 'Uploading…';
    await setDoc(doc(db, 'images', id), { data, name: file.name.slice(0, 120), bytes: bytesOf(data), createdAt: serverTimestamp() });
    setPhoto({ image: `fsimg:${id}`, preview: data, thumb });
    state.dirty = true;
    status.textContent = `Photo uploaded (${Math.round(bytesOf(data) / 1024)} KB). Click Save to use it.`;
  } catch (x) {
    status.textContent = friendly(x);
    toast(friendly(x), true);
  }
});
$('[data-remove-photo]').addEventListener('click', () => { setPhoto(null); state.dirty = true; });

// ---------- orders ----------
async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200)));
  state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  updateBadges();
}
function renderOrders() {
  const filter = $('[data-order-filter]').value;
  const list = state.orders.filter((o) => !filter || o.status === filter);
  $('[data-orders]').innerHTML = list.length ? list.map((o) => {
    const c = o.customer || {};
    return `<article class="item${o.status === 'new' ? ' is-new' : ''}">
      <div class="item-head">
        <div><h3>${esc(o.ref || o.id)}</h3><div class="item-meta">${esc(when(o.createdAt))} · ${esc(o.itemCount)} item(s)</div></div>
        <span class="status ${esc(o.status)}">${esc(o.status)}</span>
      </div>
      <div class="item-grid">
        <div><b>Customer</b>${esc(c.name)}</div>
        <div><b>Phone</b>${esc(c.phone)}</div>
        <div><b>Address</b>${esc(c.address)}, ${esc(c.city)}</div>
        <div><b>Payment</b>${esc(c.payment)}</div>
        ${c.notes ? `<div><b>Notes</b>${esc(c.notes)}</div>` : ''}
      </div>
      <ul class="item-lines">${(o.items || []).map((l) => `<li><span>${esc(l.qty)} × ${esc(l.name)} <span class="muted">(${esc(l.sku)})</span></span><span>${money(l.total)}</span></li>`).join('')}</ul>
      <div class="item-total"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
      <div class="item-actions">
        <label class="sr-only" for="st-${esc(o.id)}">Status</label>
        <select id="st-${esc(o.id)}" data-order-status="${esc(o.id)}">${ORDER_STATUS.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
        <a class="btn btn-sm" href="https://wa.me/${esc(waNumber(c.phone))}?text=${encodeURIComponent(`Hello ${c.name || ''}, thank you for your U-farm order ${o.ref || ''}.`)}" target="_blank" rel="noopener">WhatsApp customer</a>
        <button type="button" class="link danger" data-order-delete="${esc(o.id)}">Delete</button>
      </div>
    </article>`;
  }).join('') : '<p class="muted card">No orders yet. Orders appear here when customers check out on WhatsApp.</p>';
}
$('[data-order-filter]').addEventListener('change', renderOrders);
$('[data-orders]').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-order-status]');
  if (!sel) return;
  const o = state.orders.find((x) => x.id === sel.getAttribute('data-order-status'));
  try {
    await updateDoc(doc(db, 'orders', o.id), { status: sel.value });
    o.status = sel.value;
    updateBadges();
    renderOrders();
    toast(`Order ${o.ref || o.id} marked ${sel.value}.`);
  } catch (x) { toast(friendly(x), true); }
});
$('[data-orders]').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-order-delete]');
  if (!btn || !confirm('Delete this order record?')) return;
  const id = btn.getAttribute('data-order-delete');
  try {
    await deleteDoc(doc(db, 'orders', id));
    state.orders = state.orders.filter((x) => x.id !== id);
    updateBadges();
    renderOrders();
  } catch (x) { toast(friendly(x), true); }
});

// ---------- messages ----------
async function loadMessages() {
  const snap = await getDocs(query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(200)));
  state.messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  updateBadges();
}
function renderMessages() {
  $('[data-messages]').innerHTML = state.messages.length ? state.messages.map((m) => `<article class="item${m.status === 'new' ? ' is-new' : ''}">
      <div class="item-head">
        <div><h3>${esc(m.name)} — ${esc(m.topic)}</h3><div class="item-meta">${esc(when(m.createdAt))}</div></div>
        <span class="status ${esc(m.status)}">${esc(m.status)}</span>
      </div>
      <div class="item-grid">
        <div><b>Email</b><a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.topic || 'your message'))}">${esc(m.email)}</a></div>
        ${m.phone ? `<div><b>Phone</b>${esc(m.phone)}</div>` : ''}
      </div>
      <p class="item-msg">${esc(m.message)}</p>
      <div class="item-actions">
        ${m.status === 'new' ? `<button type="button" class="btn btn-sm" data-msg-read="${esc(m.id)}">Mark as read</button>` : ''}
        ${m.phone ? `<a class="btn btn-sm btn-ghost" href="https://wa.me/${esc(waNumber(m.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button type="button" class="link danger" data-msg-delete="${esc(m.id)}">Delete</button>
      </div>
    </article>`).join('') : '<p class="muted card">No messages yet. Contact-form messages appear here.</p>';
}
$('[data-messages]').addEventListener('click', async (e) => {
  const read = e.target.closest('[data-msg-read]');
  const del = e.target.closest('[data-msg-delete]');
  try {
    if (read) {
      const m = state.messages.find((x) => x.id === read.getAttribute('data-msg-read'));
      await updateDoc(doc(db, 'messages', m.id), { status: 'read' });
      m.status = 'read';
    } else if (del && confirm('Delete this message?')) {
      const id = del.getAttribute('data-msg-delete');
      await deleteDoc(doc(db, 'messages', id));
      state.messages = state.messages.filter((x) => x.id !== id);
    } else return;
    updateBadges();
    renderMessages();
  } catch (x) { toast(friendly(x), true); }
});

function updateBadges() {
  const set = (sel, n) => { const b = $(sel); b.textContent = n; b.hidden = !n; };
  set('[data-count-orders]', state.orders.filter((o) => o.status === 'new').length);
  set('[data-count-messages]', state.messages.filter((m) => m.status === 'new').length);
}

// ---------- settings ----------
const settingsForm = $('[data-settings]');
async function openSettings() {
  const [pub, priv] = await Promise.all([getDoc(doc(db, 'settings', 'site')), getDoc(doc(db, 'settings', 'private'))]);
  const s = { ...meta.siteDefaults, ...(pub.exists() ? pub.data() : {}) };
  s.address = { ...meta.siteDefaults.address, ...(pub.exists() ? pub.data().address : {}) };
  for (const el of settingsForm.elements) {
    if (!el.name) continue;
    if (el.name === 'deployHook') el.value = priv.exists() ? priv.data().deployHook || '' : '';
    else if (el.name === 'paymentMethods') el.value = (s.paymentMethods || []).join('\n');
    else if (el.name.startsWith('address.')) el.value = s.address[el.name.slice(8)] || '';
    else el.value = s[el.name] ?? '';
  }
}
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-settings-error]');
  err.hidden = true;
  const f = settingsForm;
  const whatsapp = f.whatsapp.value.replace(/\D/g, '');
  const hook = f.deployHook.value.trim();
  try {
    if (whatsapp.length < 8) throw new Error('Enter the WhatsApp number with country code, digits only.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim())) throw new Error('Enter a valid support email.');
    if (hook && !/^https:\/\/api\.vercel\.com\//.test(hook)) throw new Error('The deploy hook should start with https://api.vercel.com/');
    const site = {
      whatsapp,
      phone: f.phone.value.trim(),
      phoneDisplay: f.phoneDisplay.value.trim(),
      email: f.email.value.trim(),
      hours: f.hours.value.trim(),
      freeShippingOver: Math.max(0, Number(f.freeShippingOver.value) || 0),
      paymentMethods: lines(f.paymentMethods.value).slice(0, 10),
      address: {
        street: f['address.street'].value.trim(), city: f['address.city'].value.trim(), region: f['address.region'].value.trim(),
        postalCode: f['address.postalCode'].value.trim(), country: f['address.country'].value.trim().toUpperCase(),
      },
      updatedAt: serverTimestamp(),
    };
    await Promise.all([setDoc(doc(db, 'settings', 'site'), site), setDoc(doc(db, 'settings', 'private'), { deployHook: hook })]);
    markPending();
    toast('Settings saved. Click Publish to update the website.');
  } catch (x) {
    err.textContent = friendly(x);
    err.hidden = false;
  }
});

// ---------- routing ----------
async function route() {
  const h = location.hash || '#/';
  try {
    if (h === '#/new') return openEditor(null);
    const m = /^#\/edit\/(.+)$/.exec(h);
    if (m) {
      const p = state.products.find((x) => x.slug === decodeURIComponent(m[1]));
      if (p) return openEditor(p);
    }
    if (h === '#/orders') { show('orders'); await loadOrders(); renderOrders(); return; }
    if (h === '#/messages') { show('messages'); await loadMessages(); renderMessages(); return; }
    if (h === '#/settings') { show('settings'); await openSettings(); return; }
    renderList();
    show('list');
  } catch (x) {
    toast(friendly(x), true);
  }
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const leavingEditor = /^#\/(new|edit\/)/.test(lastHash);
  if (leavingEditor && state.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
    history.replaceState(null, '', lastHash);
    return;
  }
  state.dirty = false;
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

let started = false;
async function start() {
  if (!started) {
    started = true;
    const catOpts = meta.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
    form.category.innerHTML = catOpts;
    $('[data-filter-cat]').innerHTML = '<option value="">All categories</option>' + catOpts;
    form.art.innerHTML = meta.artKeys.map((k) => `<option value="${esc(k)}">${esc(k.replace(/-/g, ' '))}</option>`).join('');
    try { markPending(localStorage.getItem(PENDING_KEY) === '1'); } catch {}
  }
  await loadProducts();
  // Badges for new orders/messages (ignore failures, e.g. before the first order exists).
  Promise.all([loadOrders(), loadMessages()]).catch(() => {});
  await route();
}
