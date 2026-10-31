// U-farm admin panel — Firebase Auth + Firestore, hosted as a static page.
// Routes: #/ (products), #/overview, #/new, #/edit/<slug>, #/duplicate/<slug>,
//         #/orders, #/messages, #/categories, #/customers, #/settings
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  query, orderBy, limit, serverTimestamp, runTransaction, arrayUnion, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const meta = await fetch('/admin/meta.json').then((r) => r.json());
const app = initializeApp(meta.firebase);
const auth = getAuth(app);
const db = getFirestore(app);

const PAGE_SIZE = 10;
const state = {
  products: [], editing: null, dirty: false, slugTouched: false, photos: [],
  orders: [], messages: [], page: 1, featuredOnly: false,
  settings: {}, coupons: [], editingCoupon: null, posts: [], editingPost: null,
};
const MAX_PHOTOS = 8;
const lowStockAt = () => (Number.isFinite(state.settings.lowStockAt) ? state.settings.lowStockAt : 3);
const isLow = (p) => Number.isFinite(p.qty) && p.qty <= lowStockAt();
const STOCK = { InStock: 'In stock', PreOrder: 'Pre-order', OutOfStock: 'Out of stock' };
const ORDER_STATUS = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const MAX_IMAGE_BYTES = 700 * 1024; // keeps image documents well under Firestore's 1 MiB limit

// ---------- helpers ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const money = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: meta.currency, maximumFractionDigits: 0 }).format(n || 0);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const toDate = (ts) => (ts && ts.toDate ? ts.toDate() : null);
const when = (ts) => (toDate(ts) ? toDate(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const imagesOf = (p) => (Array.isArray(p.images) && p.images.length ? p.images : p.image ? [p.image] : []);
const imageOf = (p) => {
  const first = imagesOf(p)[0];
  return p.thumb || (first && !first.startsWith('fsimg:') ? first : `/assets/img/products/${p.art || 'meter-cup'}.svg`);
};
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

function download(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- layout ----------
const TAB_OF = { list: 'products', edit: 'products', 'guide-edit': 'guides' };
function show(view) {
  $$('[data-view]').forEach((v) => { v.hidden = v.getAttribute('data-view') !== view; });
  const authed = !['login', 'denied', 'loading'].includes(view);
  $$('[data-authed]').forEach((el) => { el.hidden = !authed; });
  const tab = TAB_OF[view] || view;
  $$('[data-tab]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-tab') === tab));
  $$('[data-side]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-side') === tab));
  setSidebar(false);
  closeMenu();
  window.scrollTo(0, 0);
}
function setSidebar(open) {
  $('.sidebar').classList.toggle('open', open);
  $('[data-sidebar-scrim]').hidden = !open;
}
$('[data-sidebar-toggle]').addEventListener('click', () => setSidebar(!$('.sidebar').classList.contains('open')));
$('[data-sidebar-scrim]').addEventListener('click', () => setSidebar(false));

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

// ---------- products: list ----------
async function loadProducts() {
  const snap = await getDocs(collection(db, 'products'));
  state.products = snap.docs
    .map((d) => ({ ...d.data(), slug: d.id }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function filteredProducts() {
  const q = $('[data-search]').value.trim().toLowerCase();
  const cat = $('[data-filter-cat]').value;
  const stock = $('[data-filter-stock]').value;
  return state.products.filter((p) => {
    if (cat && p.category !== cat) return false;
    if (stock && p.stock !== stock) return false;
    if (state.featuredOnly && !p.featured) return false;
    if (state.lowOnly && !(isLow(p) && p.qty > 0)) return false;
    if (q && `${p.name} ${p.sku} ${p.brand || ''}`.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

function renderList() {
  const all = state.products;
  $('[data-stat-total]').textContent = all.length;
  $('[data-stat-featured]').textContent = all.filter((p) => p.featured).length;
  $('[data-stat-in]').textContent = all.filter((p) => p.stock === 'InStock').length;
  $('[data-stat-out]').textContent = all.filter((p) => p.stock === 'OutOfStock').length;
  const stock = $('[data-filter-stock]').value;
  $$('[data-stat]').forEach((b) => {
    const k = b.getAttribute('data-stat');
    b.classList.toggle('active', (k === 'featured' && state.featuredOnly) || (k === stock && !!stock));
  });
  const note = $('[data-filter-note]');
  note.hidden = !state.featuredOnly && !state.lowOnly;
  if (state.featuredOnly || state.lowOnly) {
    note.innerHTML = `Showing ${state.lowOnly ? 'low-stock' : 'featured'} products only. <button type="button" class="link" data-clear-featured>Show all</button>`;
  }

  const rows = filteredProducts();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  $('[data-rows]').innerHTML = pageRows.map((p) => `<tr>
    <td><div class="prod"><img class="thumb" src="${esc(imageOf(p))}" alt="" loading="lazy">
      <div><a class="pname" href="#/edit/${esc(p.slug)}">${esc(p.name)}</a><div class="sub">${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''}</div></div></div></td>
    <td><div class="cat-main">${esc(catOf(p.category)?.name || p.category)}</div><div class="sub">${esc(subName(p.category, p.sub))}</div></td>
    <td class="price-cell">${money(p.price)}${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}</td>
    <td><span class="pill ${esc(p.stock)}">${STOCK[p.stock] || esc(p.stock)}</span>${Number.isFinite(p.qty) ? `<span class="qty-note${isLow(p) ? ' low' : ''}">${p.qty} unit${p.qty === 1 ? '' : 's'}${isLow(p) ? ' — low' : ''}</span>` : ''}</td>
    <td class="c"><button type="button" class="star${p.featured ? ' on' : ''}" data-star="${esc(p.slug)}" aria-label="${p.featured ? 'Remove from' : 'Add to'} home page" title="${p.featured ? 'Featured on home page' : 'Not featured'}">${icon(p.featured ? 'star' : 'star-o')}</button></td>
    <td class="c"><span class="acts">
      <a class="icon-act" href="#/edit/${esc(p.slug)}" aria-label="Edit ${esc(p.name)}" title="Edit">${icon('pencil')}</a>
      <button type="button" class="icon-act" data-more="${esc(p.slug)}" aria-label="More actions for ${esc(p.name)}" aria-haspopup="menu" title="More">${icon('dots')}</button>
    </span></td>
  </tr>`).join('');

  $('[data-empty]').hidden = rows.length > 0 || all.length === 0;
  $('[data-empty-catalog]').hidden = all.length > 0;
  renderPager(rows.length, pages);
}

function renderPager(total, pages) {
  const pager = $('[data-pager]');
  if (!total) { pager.innerHTML = ''; return; }
  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, state.page * PAGE_SIZE);
  // 1 … 4 5 6 … 9 style page list
  const nums = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - state.page) <= 1 || (state.page <= 3 && n <= 5) || (state.page >= pages - 2 && n >= pages - 4)) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  pager.innerHTML = `<p>Showing ${from}–${to} of ${total} product${total === 1 ? '' : 's'}</p>
    <div class="pages">
      <button type="button" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevl', 'i i-sm')}</button>
      ${nums.map((n) => (n === '…' ? '<span class="gap">…</span>' : `<button type="button" data-page="${n}" class="${n === state.page ? 'on' : ''}" ${n === state.page ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}
      <button type="button" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chev', 'i i-sm')}</button>
    </div>`;
}

['[data-search]', '[data-filter-cat]', '[data-filter-stock]'].forEach((s) => $(s).addEventListener('input', () => { state.page = 1; renderList(); }));
$('[data-pager]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  state.page = Number(b.getAttribute('data-page'));
  renderList();
  $('.table-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
$('[data-filter-note]').addEventListener('click', (e) => {
  if (e.target.closest('[data-clear-featured]')) { state.featuredOnly = false; state.lowOnly = false; state.page = 1; renderList(); }
});

// Summary cards filter the list.
$$('[data-stat]').forEach((b) => b.addEventListener('click', () => {
  const k = b.getAttribute('data-stat');
  const stockSel = $('[data-filter-stock]');
  state.lowOnly = false;
  if (k === 'all') { state.featuredOnly = false; stockSel.value = ''; $('[data-search]').value = ''; $('[data-filter-cat]').value = ''; }
  else if (k === 'featured') { state.featuredOnly = !state.featuredOnly; }
  else { stockSel.value = stockSel.value === k ? '' : k; }
  state.page = 1;
  renderList();
}));

$('[data-export]').addEventListener('click', () => {
  const rows = filteredProducts();
  download(`u-farm-products-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Name', 'SKU', 'Brand', 'Category', 'Sub-category', 'Price (NGN)', 'Was price (NGN)', 'Stock', 'Featured', 'Page'],
    ...rows.map((p) => [p.name, p.sku, p.brand || '', catOf(p.category)?.name || p.category, subName(p.category, p.sub), p.price, p.oldPrice || '', STOCK[p.stock] || p.stock, p.featured ? 'Yes' : 'No', `${location.origin}/products/${p.slug}/`]),
  ]);
  toast(`Exported ${rows.length} product${rows.length === 1 ? '' : 's'}.`);
});

$('[data-rows]').addEventListener('click', async (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { openMenu(more, more.getAttribute('data-more')); return; }
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

// ⋯ menu
const menu = $('[data-menu]');
function openMenu(anchor, slug) {
  if (!menu.hidden && menu.dataset.slug === slug) { closeMenu(); return; }
  const p = state.products.find((x) => x.slug === slug);
  menu.dataset.slug = slug;
  menu.innerHTML = `
    <a href="/products/${esc(slug)}/" target="_blank" rel="noopener" role="menuitem">${icon('eye')}View on shop</a>
    <button type="button" data-act="duplicate" role="menuitem">${icon('plus')}Duplicate</button>
    <button type="button" data-act="feature" role="menuitem">${icon(p.featured ? 'star-o' : 'star')}${p.featured ? 'Remove from home page' : 'Feature on home page'}</button>
    <hr>
    <button type="button" data-act="delete" class="danger" role="menuitem">${icon('ban')}Delete</button>`;
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${window.scrollY + r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(window.scrollX + r.right - w, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
}
function closeMenu() { menu.hidden = true; delete menu.dataset.slug; }
document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('[data-menu]') && !e.target.closest('[data-more]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); setSidebar(false); } });
window.addEventListener('resize', closeMenu);
menu.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]');
  if (!act) { if (e.target.closest('a')) closeMenu(); return; }
  const p = state.products.find((x) => x.slug === menu.dataset.slug);
  closeMenu();
  const action = act.getAttribute('data-act');
  if (action === 'duplicate') location.hash = `#/duplicate/${encodeURIComponent(p.slug)}`;
  if (action === 'feature') $(`[data-star="${CSS.escape(p.slug)}"]`)?.click();
  if (action === 'delete') deleteProduct(p);
});

// One-click import of the catalog that is currently on the website.
$('[data-import]').addEventListener('click', async () => {
  const btn = $('[data-import]');
  if (!confirm('Import the 34 example products into your shop?')) return;
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
    btn.textContent = 'Or import the 34 example products';
  }
});

// ---------- editor ----------
const form = $('[data-editor]');

function fillSubs(catSlug, selected) {
  const c = catOf(catSlug) || meta.categories[0];
  form.sub.innerHTML = c.subs.map((s) => `<option value="${esc(s.slug)}"${s.slug === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

// state.photos: [{ image: 'fsimg:id' | '/path', preview, thumb }], first = main.
function renderPhotos() {
  const photos = state.photos;
  const img = $('[data-photo-img]');
  if (photos.length) img.src = photos[0].preview || photos[0].thumb || '';
  img.hidden = !photos.length;
  $('[data-photo-empty]').hidden = photos.length > 0;
  $('[data-art-wrap]').hidden = photos.length > 0;
  $('[data-photo-count]').textContent = photos.length ? `${photos.length} / ${MAX_PHOTOS}` : '';
  $('[data-gallery-list]').innerHTML = photos.map((ph, i) => `<li>
    <img src="${esc(ph.thumb || ph.preview || '')}" alt="Photo ${i + 1}">
    <div class="g-acts">
      <button type="button" data-ph-move="${i}" data-dir="-1" aria-label="Move photo ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button type="button" data-ph-remove="${i}" aria-label="Remove photo ${i + 1}">${icon('x')}</button>
      <button type="button" class="g-next" data-ph-move="${i}" data-dir="1" aria-label="Move photo ${i + 1} later" ${i === photos.length - 1 ? 'disabled' : ''}>${icon('up')}</button>
    </div></li>`).join('');
}
$('[data-gallery-list]').addEventListener('click', (e) => {
  const mv = e.target.closest('[data-ph-move]');
  const rm = e.target.closest('[data-ph-remove]');
  if (mv) {
    const i = Number(mv.getAttribute('data-ph-move'));
    const j = i + Number(mv.getAttribute('data-dir'));
    [state.photos[i], state.photos[j]] = [state.photos[j], state.photos[i]];
  } else if (rm) {
    state.photos.splice(Number(rm.getAttribute('data-ph-remove')), 1);
  } else return;
  state.dirty = true;
  renderPhotos();
});

// Loads full-size previews for photos stored in Firestore.
function loadPhotoPreviews() {
  state.photos.forEach((ph) => {
    if (!ph.image.startsWith('fsimg:') || ph.preview) return;
    getDoc(doc(db, 'images', ph.image.slice(6))).then((d) => {
      if (!d.exists()) return;
      ph.preview = d.data().data;
      if (!ph.thumb) ph.thumb = ph.preview;
      renderPhotos();
    });
  });
}

// p = product to edit; copyOf = product to duplicate into a new one.
async function openEditor(p, copyOf) {
  const isNew = !p;
  state.editing = p || null;
  state.slugTouched = !!p;
  const src = p || (copyOf ? { ...copyOf, name: `${copyOf.name} (copy)`, sku: `${copyOf.sku}-COPY`, slug: '', featured: false } : null)
    || { stock: 'InStock', category: meta.categories[0].slug, art: 'meter-cup', specs: {}, description: [], features: [], uses: [] };

  $('[data-edit-title]').textContent = p ? 'Edit product' : copyOf ? 'Duplicate product' : 'Add product';
  form.reset();
  form.name.value = src.name || '';
  form.slug.value = isNew ? slugify(src.name || '') : src.slug;
  if (!src.name) form.slug.value = '';
  form.slug.readOnly = !isNew;
  $('[data-slug-hint]').textContent = isNew
    ? `Page address: /products/${form.slug.value || '…'}/ — cannot be changed later`
    : `Page address is fixed: /products/${src.slug}/`;
  form.sku.value = src.sku || '';
  form.brand.value = src.brand || '';
  form.category.value = src.category;
  fillSubs(src.category, src.sub);
  form.short.value = src.short || '';
  form.description.value = (src.description || []).join('\n\n');
  form.features.value = (src.features || []).join('\n');
  form.specs.value = Object.entries(src.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  form.uses.value = (src.uses || []).join('\n');
  form.art.value = src.art || 'meter-cup';
  form.price.value = src.price != null ? src.price : '';
  form.oldPrice.value = src.oldPrice || '';
  form.stock.value = src.stock || 'InStock';
  form.featured.checked = !!src.featured;
  updateShortCount();

  const thumbs = Array.isArray(src.thumbs) ? src.thumbs : [src.thumb];
  state.photos = imagesOf(src).map((ref, i) => (ref.startsWith('fsimg:')
    ? { image: ref, preview: '', thumb: thumbs[i] || '' }
    : { image: ref, preview: ref, thumb: ref }));
  renderPhotos();
  loadPhotoPreviews();
  form.qty.value = Number.isFinite(src.qty) ? src.qty : '';

  const live = $('[data-view-live]');
  live.hidden = isNew;
  if (!isNew) live.href = `/products/${src.slug}/`;
  $('[data-delete]').hidden = isNew;
  $('[data-form-error]').hidden = true;
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $('[data-upload-status]').textContent = 'JPG, PNG or WebP. Photos are resized automatically.';
  state.dirty = !!copyOf;
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
  if (state.photos.length) {
    p.images = state.photos.map((ph) => ph.image);
    // Small thumbnails for the admin list only (the website uses the full photos).
    p.thumbs = state.photos.map((ph) => (ph.image.startsWith('fsimg:') && ph.thumb && ph.thumb.startsWith('data:') ? ph.thumb : ''));
    if (p.thumbs[0]) p.thumb = p.thumbs[0];
  } else {
    p.art = form.art.value || 'meter-cup';
  }
  if (form.qty.value !== '') {
    const qty = Number(form.qty.value);
    if (!Number.isInteger(qty) || qty < 0) fail('Units in stock must be a whole number (0 or more).', 'qty');
    p.qty = qty;
    if (qty === 0 && p.stock === 'InStock') p.stock = 'OutOfStock';
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
    if (old) {
      const kept = new Set(data.product.images || []);
      for (const ref of imagesOf(old)) if (!kept.has(ref)) await removeImageIfUnused(ref, data.slug);
    }
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
  if (state.products.some((x) => x.slug !== exceptSlug && imagesOf(x).includes(image))) return;
  try { await deleteDoc(doc(db, 'images', image.slice(6))); } catch { /* not critical */ }
}

async function deleteProduct(p) {
  if (!p || !confirm(`Delete "${p.name}"? Its page will be removed from the shop when you publish.`)) return false;
  try {
    await deleteDoc(doc(db, 'products', p.slug));
    state.products = state.products.filter((x) => x.slug !== p.slug);
    for (const ref of imagesOf(p)) await removeImageIfUnused(ref, p.slug);
    markPending();
    toast('Product deleted. Click Publish to update the website.');
    if (location.hash === '#/' || location.hash === '') renderList();
    return true;
  } catch (x) {
    toast(friendly(x), true);
    return false;
  }
}
$('[data-delete]').addEventListener('click', async () => {
  if (await deleteProduct(state.editing)) { state.dirty = false; location.hash = '#/'; }
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

// Resizes a photo in the browser and stores it in Firestore (images/{id}).
async function uploadImage(file, nameHint) {
  const img = await loadImage(file);
  let max = 1400, q = 0.85, data = encode(img, max, q);
  while (bytesOf(data) > MAX_IMAGE_BYTES && max > 600) { max -= 200; q -= 0.05; data = encode(img, max, q); }
  if (bytesOf(data) > MAX_IMAGE_BYTES) throw new Error(`"${file.name}" is too detailed to store. Try a smaller image.`);
  const thumb = encode(img, 200, 0.7);
  const id = `${slugify(nameHint || file.name.replace(/\.\w+$/, '')).slice(0, 60) || 'photo'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await setDoc(doc(db, 'images', id), { data, name: file.name.slice(0, 120), bytes: bytesOf(data), createdAt: serverTimestamp() });
  return { id, data, thumb, kb: Math.round(bytesOf(data) / 1024) };
}

$('[data-file]').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const status = $('[data-upload-status]');
  const room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) { toast(`A product can have up to ${MAX_PHOTOS} photos.`, true); return; }
  const batch = files.slice(0, room);
  let done = 0;
  for (const file of batch) {
    status.textContent = `Uploading photo ${done + 1} of ${batch.length}…`;
    try {
      const up = await uploadImage(file, form.slug.value);
      state.photos.push({ image: `fsimg:${up.id}`, preview: up.data, thumb: up.thumb });
      done++;
      state.dirty = true;
      renderPhotos();
    } catch (x) {
      toast(friendly(x), true);
    }
  }
  status.textContent = done
    ? `${done} photo${done === 1 ? '' : 's'} uploaded${files.length > batch.length ? ` (limit is ${MAX_PHOTOS})` : ''}. Click Save to keep ${done === 1 ? 'it' : 'them'}.`
    : 'No photos were uploaded.';
});

// ---------- orders ----------
async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(500)));
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
  sel.disabled = true;
  try {
    const res = await setOrderStatus(o.id, sel.value);
    o.status = sel.value;
    o.stockDeducted = res.stockDeducted;
    if (res.stockChanged.length) {
      await loadProducts();
      markPending();
    }
    updateBadges();
    renderOrders();
    const stockMsg = res.stockChanged.length ? ` Stock ${res.stockDeducted ? 'reduced' : 'restored'} for ${res.stockChanged.length} product${res.stockChanged.length === 1 ? '' : 's'} — publish to update the shop.` : '';
    toast(`Order ${o.ref || o.id} marked ${sel.value}.${stockMsg}`);
  } catch (x) {
    toast(friendly(x), true);
    sel.value = o.status;
  } finally {
    sel.disabled = false;
  }
});

// Changes an order's status in one transaction:
// - updates the order and the customer's tracking page (with a timeline entry)
// - takes the units out of stock when an order is first confirmed/shipped/delivered,
//   and puts them back if it is cancelled (or reset to new) later.
const COUNTS_AGAINST_STOCK = ['confirmed', 'shipped', 'delivered'];
async function setOrderStatus(orderId, status) {
  return runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'orders', orderId);
    const trackRef = doc(db, 'tracking', orderId);
    const [orderSnap, trackSnap] = await Promise.all([tx.get(orderRef), tx.get(trackRef)]);
    if (!orderSnap.exists()) throw new Error('This order no longer exists.');
    const order = orderSnap.data();
    const wasDeducted = !!order.stockDeducted;
    const deduct = COUNTS_AGAINST_STOCK.includes(status) && !wasDeducted;
    const restore = !COUNTS_AGAINST_STOCK.includes(status) && wasDeducted;

    // Quantities per product in this order.
    const need = new Map();
    for (const l of order.items || []) need.set(l.slug, (need.get(l.slug) || 0) + (Number(l.qty) || 0));
    const changes = [];
    if (deduct || restore) {
      const snaps = await Promise.all([...need.keys()].map((slug) => tx.get(doc(db, 'products', slug))));
      snaps.forEach((s) => {
        if (!s.exists() || !Number.isFinite(s.data().qty)) return; // stock not tracked
        const p = s.data();
        const qty = Math.max(0, p.qty + (deduct ? -1 : 1) * need.get(s.id));
        let stock = p.stock;
        if (qty === 0 && stock === 'InStock') stock = 'OutOfStock';
        if (qty > 0 && stock === 'OutOfStock') stock = 'InStock';
        changes.push({ ref: s.ref, qty, stock });
      });
    }

    const now = Timestamp.now();
    const stockDeducted = deduct ? true : restore ? false : wasDeducted;
    tx.update(orderRef, { status, stockDeducted });
    if (trackSnap.exists()) tx.update(trackRef, { status, updatedAt: now, history: arrayUnion({ status, at: now }) });
    changes.forEach((c) => tx.update(c.ref, { qty: c.qty, stock: c.stock, updatedAt: serverTimestamp() }));
    return { stockDeducted, stockChanged: changes };
  });
}
$('[data-orders]').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-order-delete]');
  if (!btn || !confirm('Delete this order record?')) return;
  const id = btn.getAttribute('data-order-delete');
  try {
    await deleteDoc(doc(db, 'orders', id));
    await deleteDoc(doc(db, 'tracking', id)).catch(() => {});
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
        ${m.phone ? `<a class="btn btn-sm btn-outline" href="https://wa.me/${esc(waNumber(m.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
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
  const set = (sel, n) => $$(sel).forEach((b) => { b.textContent = n; b.hidden = !n; });
  set('[data-count-orders]', state.orders.filter((o) => o.status === 'new').length);
  set('[data-count-messages]', state.messages.filter((m) => m.status === 'new').length);
}

// ---------- overview ----------
function renderOverview() {
  const live = state.orders.filter((o) => o.status !== 'cancelled');
  const since = Date.now() - 30 * 864e5;
  const recentRevenue = live.filter((o) => toDate(o.createdAt) && toDate(o.createdAt).getTime() >= since).reduce((s, o) => s + (o.subtotal || 0), 0);
  const newOrders = state.orders.filter((o) => o.status === 'new').length;
  const newMsgs = state.messages.filter((m) => m.status === 'new').length;
  const stat = (tone, ic, label, value, href) => `<a class="stat ${tone}" href="${href}"><span class="stat-ico${ic === 'check' ? ' solid' : ''}">${icon(ic)}</span><span class="stat-body"><small>${label}</small><b>${value}</b></span>${icon('chev', 'i stat-go')}</a>`;
  $('[data-overview-stats]').innerHTML =
    stat('tone-green', 'box', 'Products', state.products.length, '#/') +
    stat('tone-orange', 'truck', 'New orders', newOrders, '#/orders') +
    stat('tone-green', 'cash', 'Order value (30 days)', money(recentRevenue), '#/orders') +
    stat('tone-red', 'mail', 'Unread messages', newMsgs, '#/messages');

  const recent = state.orders.slice(0, 5);
  $('[data-recent-orders]').innerHTML = recent.length ? recent.map((o) => `<div class="mini">
      <div><b>${esc((o.customer || {}).name || o.ref)}</b><div class="sub">${esc(o.ref)} · ${esc(when(o.createdAt))}</div></div>
      <div style="text-align:right"><b>${money(o.subtotal)}</b><div><span class="status ${esc(o.status)}">${esc(o.status)}</span></div></div>
    </div>`).join('') : '<p class="muted">No orders yet.</p>';

  const out = state.products.filter((p) => p.stock === 'OutOfStock').length;
  const noPhoto = state.products.filter((p) => !imagesOf(p).length).length;
  const low = state.products.filter((p) => isLow(p) && p.qty > 0 && p.stock !== 'OutOfStock').length;
  const todo = [
    [newOrders, 'New orders to confirm', '#/orders', true, ''],
    [newMsgs, 'Unread messages', '#/messages', true, ''],
    [low, `Low stock (${lowStockAt()} or fewer left)`, '#/', true, 'low'],
    [out, 'Products out of stock', '#/', false, 'OutOfStock'],
    [noPhoto, 'Products without a real photo', '#/', false, ''],
  ].filter(([n]) => n > 0);
  $('[data-todo]').innerHTML = todo.length
    ? todo.map(([n, label, href, warn, goto]) => `<li class="${warn ? 'warn' : ''}"><a href="${href}"${goto ? ` data-goto-stock="${goto}"` : ''}>${label}<b class="count">${n}</b></a></li>`).join('')
    : '<li class="muted">All caught up.</li>';
  if ($('[data-publish]').classList.contains('pending')) {
    $('[data-todo]').insertAdjacentHTML('afterbegin', '<li class="warn"><a href="#" data-do-publish>Unpublished changes — publish now<b class="count">!</b></a></li>');
  }
}
$('[data-todo]').addEventListener('click', (e) => {
  if (e.target.closest('[data-do-publish]')) { e.preventDefault(); $('[data-publish]').click(); }
  const s = e.target.closest('[data-goto-stock]');
  if (s) {
    const g = s.getAttribute('data-goto-stock');
    state.lowOnly = g === 'low';
    $('[data-filter-stock]').value = g === 'low' ? '' : g;
    state.page = 1;
  }
});

// ---------- categories ----------
function renderCategories() {
  const n = (fn) => state.products.filter(fn).length;
  $('[data-categories]').innerHTML = meta.categories.map((c) => `<div class="card cat-card">
      <h2><a href="/${esc(c.slug)}/" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(c.name)}</a><span class="badge-n">${n((p) => p.category === c.slug)}</span></h2>
      <ul>${c.subs.map((s) => `<li><a href="/${esc(c.slug)}/${esc(s.slug)}/" target="_blank" rel="noopener">${esc(s.name)}</a><span class="badge-n">${n((p) => p.sub === s.slug)}</span></li>`).join('')}</ul>
    </div>`).join('');
}

// ---------- customers (built from orders) ----------
function customerList() {
  const map = new Map();
  for (const o of state.orders) {
    const c = o.customer || {};
    const key = waNumber(c.phone) || (c.name || '').toLowerCase();
    if (!key) continue;
    const cur = map.get(key) || { name: c.name, phone: c.phone, city: c.city, address: c.address, orders: 0, total: 0, last: null };
    cur.orders += 1;
    if (o.status !== 'cancelled') cur.total += o.subtotal || 0;
    const d = toDate(o.createdAt);
    if (d && (!cur.last || d > cur.last)) { cur.last = d; cur.name = c.name || cur.name; cur.city = c.city || cur.city; cur.address = c.address || cur.address; }
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (b.last || 0) - (a.last || 0));
}
function renderCustomers() {
  const list = customerList();
  $('[data-customers]').innerHTML = list.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="sub">${esc(c.phone)}</div></td>
      <td>${esc(c.city)}</td>
      <td>${c.orders}</td>
      <td class="price-cell">${money(c.total)}</td>
      <td>${c.last ? esc(c.last.toLocaleDateString('en-GB', { dateStyle: 'medium' })) : ''}</td>
      <td class="c"><a class="btn btn-sm" href="https://wa.me/${esc(waNumber(c.phone))}" target="_blank" rel="noopener">WhatsApp</a></td>
    </tr>`).join('');
  $('[data-customers-empty]').hidden = list.length > 0;
}
$('[data-export-customers]').addEventListener('click', () => {
  const list = customerList();
  download(`u-farm-customers-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Name', 'Phone', 'Town/City', 'Address', 'Orders', 'Total spent (NGN)', 'Last order'],
    ...list.map((c) => [c.name, c.phone, c.city, c.address, c.orders, c.total, c.last ? c.last.toISOString().slice(0, 10) : '']),
  ]);
});

// ---------- discounts ----------
const couponForm = $('[data-coupon-editor]');
const todayISO = () => new Date().toISOString().slice(0, 10);
const couponState = (c) => {
  if (!c.active) return ['inactive', 'Inactive'];
  if (c.expires && c.expires < todayISO()) return ['expired', 'Expired'];
  if (c.maxUses && c.uses >= c.maxUses) return ['used', 'Used up'];
  return ['active', 'Active'];
};

async function loadCoupons() {
  const snap = await getDocs(collection(db, 'coupons'));
  state.coupons = snap.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => a.code.localeCompare(b.code));
}
function renderCoupons() {
  $('[data-coupons]').innerHTML = state.coupons.map((c) => {
    const [cls, label] = couponState(c);
    return `<tr>
      <td><span class="code-chip">${esc(c.code)}</span></td>
      <td>${c.type === 'percent' ? `${esc(c.value)}% off` : `${money(c.value)} off`}</td>
      <td>${c.minOrder ? money(c.minOrder) : '—'}</td>
      <td>${c.expires ? esc(new Date(c.expires + 'T00:00:00').toLocaleDateString('en-GB', { dateStyle: 'medium' })) : 'Never'}</td>
      <td>${esc(c.uses || 0)}${c.maxUses ? ` / ${esc(c.maxUses)}` : ''}</td>
      <td><span class="status ${cls}">${label}</span></td>
      <td class="c"><span class="acts">
        <button type="button" class="icon-act" data-coupon-edit="${esc(c.code)}" aria-label="Edit ${esc(c.code)}" title="Edit">${icon('pencil')}</button>
        <button type="button" class="icon-act" data-coupon-del="${esc(c.code)}" aria-label="Delete ${esc(c.code)}" title="Delete">${icon('ban')}</button>
      </span></td>
    </tr>`;
  }).join('');
  $('[data-coupons-empty]').hidden = state.coupons.length > 0;
}
function openCoupon(c) {
  state.editingCoupon = c || null;
  couponForm.reset();
  $('[data-coupon-title]').textContent = c ? `Edit ${c.code}` : 'New discount code';
  couponForm.code.readOnly = !!c;
  if (c) {
    couponForm.code.value = c.code;
    couponForm.type.value = c.type;
    couponForm.value.value = c.value;
    couponForm.minOrder.value = c.minOrder || '';
    couponForm.expires.value = c.expires || '';
    couponForm.maxUses.value = c.maxUses || '';
    couponForm.active.checked = !!c.active;
  }
  updateValueHint();
  $('[data-coupon-error]').hidden = true;
  couponForm.hidden = false;
  couponForm.scrollIntoView({ block: 'start', behavior: 'smooth' });
  (c ? couponForm.value : couponForm.code).focus();
}
const updateValueHint = () => {
  $('[data-value-hint]').textContent = couponForm.type.value === 'percent' ? 'Percent off the order total (1–90)' : 'Naira off the order total';
};
couponForm.type.addEventListener('change', updateValueHint);
$('[data-coupon-new]').addEventListener('click', () => openCoupon(null));
$('[data-coupon-cancel]').addEventListener('click', () => { couponForm.hidden = true; });
couponForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-coupon-error]');
  err.hidden = true;
  const f = couponForm;
  try {
    const code = f.code.value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) throw new Error('Codes use 2–20 letters, numbers or dashes, e.g. HARVEST10.');
    if (!state.editingCoupon && state.coupons.some((c) => c.code === code)) throw new Error(`The code ${code} already exists.`);
    const value = Number(f.value.value);
    if (!Number.isInteger(value) || value < 1) throw new Error('Enter a discount value of 1 or more.');
    if (f.type.value === 'percent' && value > 90) throw new Error('A percentage discount can be at most 90%.');
    const data = {
      type: f.type.value,
      value,
      minOrder: Math.max(0, Math.floor(Number(f.minOrder.value) || 0)),
      expires: f.expires.value || '',
      maxUses: Math.max(0, Math.floor(Number(f.maxUses.value) || 0)),
      active: f.active.checked,
      uses: state.editingCoupon ? state.editingCoupon.uses || 0 : 0,
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'coupons', code), data);
    await loadCoupons();
    renderCoupons();
    f.hidden = true;
    toast(`Code ${code} saved — customers can use it now.`);
  } catch (x) {
    err.textContent = friendly(x);
    err.hidden = false;
  }
});
$('[data-coupons]').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-coupon-edit]');
  const del = e.target.closest('[data-coupon-del]');
  if (ed) openCoupon(state.coupons.find((c) => c.code === ed.getAttribute('data-coupon-edit')));
  if (del) {
    const code = del.getAttribute('data-coupon-del');
    if (!confirm(`Delete the code ${code}? Customers will no longer be able to use it.`)) return;
    try {
      await deleteDoc(doc(db, 'coupons', code));
      state.coupons = state.coupons.filter((c) => c.code !== code);
      renderCoupons();
      toast(`Code ${code} deleted.`);
    } catch (x) { toast(friendly(x), true); }
  }
});

// ---------- guides (blog) ----------
const postForm = $('[data-post-editor]');
const rte = $('[data-post-body]');

async function loadPosts() {
  const snap = await getDocs(collection(db, 'posts'));
  state.posts = snap.docs.map((d) => ({ slug: d.id, ...d.data() })).sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
}
function renderPosts() {
  $('[data-posts]').innerHTML = state.posts.map((p) => `<tr>
      <td><a class="pname" href="#/guide/${esc(p.slug)}">${esc(p.title)}</a><div class="sub">/guides/${esc(p.slug)}/</div></td>
      <td>${p.date ? esc(new Date(p.date + 'T00:00:00').toLocaleDateString('en-GB', { dateStyle: 'medium' })) : ''}</td>
      <td><span class="status ${p.published ? 'active' : 'inactive'}">${p.published ? 'Published' : 'Draft'}</span></td>
      <td class="c"><span class="acts">
        <a class="icon-act" href="#/guide/${esc(p.slug)}" aria-label="Edit ${esc(p.title)}" title="Edit">${icon('pencil')}</a>
        ${p.published ? `<a class="icon-act" href="/guides/${esc(p.slug)}/" target="_blank" rel="noopener" aria-label="View ${esc(p.title)}" title="View on site">${icon('eye')}</a>` : ''}
      </span></td>
    </tr>`).join('');
  $('[data-posts-empty]').hidden = state.posts.length > 0;
  $('[data-posts]').closest('.table-card').hidden = state.posts.length === 0;
}

$('[data-posts-import]').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!confirm('Import the 3 example guides? You can edit or delete them afterwards.')) return;
  btn.disabled = true;
  try {
    const seed = await fetch('/admin/seed-posts.json').then((r) => r.json());
    const batch = writeBatch(db);
    seed.forEach((p) => batch.set(doc(db, 'posts', p.slug), {
      title: p.title, excerpt: p.excerpt || '', metaDescription: p.metaDescription || '', date: p.date,
      related: p.related || [], body: p.body.trim(), published: true, updatedAt: serverTimestamp(),
    }));
    await batch.commit();
    await loadPosts();
    renderPosts();
    markPending();
    toast(`Imported ${seed.length} guides. Click Publish to put them on the website.`);
  } catch (x) {
    toast(friendly(x), true);
  } finally {
    btn.disabled = false;
  }
});

// Firestore photo references (fsimg:id) are shown in the editor as real images.
function bodyToEditor(html) {
  rte.innerHTML = html || '';
  $$('img', rte).forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('fsimg:')) return;
    const id = src.slice(6);
    img.setAttribute('data-fsimg', id);
    img.removeAttribute('src');
    getDoc(doc(db, 'images', id)).then((d) => { if (d.exists()) img.src = d.data().data; });
  });
}
function editorToBody() {
  const clone = rte.cloneNode(true);
  $$('img', clone).forEach((img) => {
    const id = img.getAttribute('data-fsimg');
    if (id) { img.setAttribute('src', `fsimg:${id}`); img.removeAttribute('data-fsimg'); }
    else if ((img.getAttribute('src') || '').startsWith('data:')) img.remove(); // pasted images aren't stored
  });
  return clone.innerHTML.replace(/&nbsp;/g, ' ').trim();
}

function renderRelated(selected) {
  const q = $('[data-related-filter]').value.trim().toLowerCase();
  const sel = new Set(selected);
  $('[data-related]').innerHTML = state.products
    .filter((p) => !q || p.name.toLowerCase().includes(q) || sel.has(p.slug))
    .map((p) => `<label><input type="checkbox" value="${esc(p.slug)}"${sel.has(p.slug) ? ' checked' : ''}>${esc(p.name)}</label>`)
    .join('') || '<p class="muted small">No products yet.</p>';
}
const selectedRelated = () => $$('[data-related] input:checked').map((i) => i.value);
$('[data-related-filter]').addEventListener('input', () => {
  const keep = new Set([...(state.relatedPick || []), ...selectedRelated()]);
  state.relatedPick = [...keep];
  renderRelated(state.relatedPick);
});
$('[data-related]').addEventListener('change', (e) => {
  const v = e.target.value;
  const keep = new Set(state.relatedPick || []);
  e.target.checked ? keep.add(v) : keep.delete(v);
  state.relatedPick = [...keep];
  state.dirty = true;
});

function openPost(p) {
  state.editingPost = p || null;
  state.postSlugTouched = !!p;
  postForm.reset();
  $('[data-post-title]').textContent = p ? 'Edit guide' : 'New guide';
  postForm.title.value = p ? p.title : '';
  postForm.slug.value = p ? p.slug : '';
  postForm.slug.readOnly = !!p;
  $('[data-post-slug-hint]').textContent = p ? `Address is fixed: /guides/${p.slug}/` : 'Address: /guides/…/ — cannot be changed later';
  postForm.published.checked = p ? !!p.published : false;
  postForm.date.value = (p && p.date) || todayISO();
  postForm.excerpt.value = (p && p.excerpt) || '';
  postForm.metaDescription.value = (p && p.metaDescription) || '';
  updateMetaCount();
  bodyToEditor(p ? p.body : '');
  state.relatedPick = p && Array.isArray(p.related) ? [...p.related] : [];
  $('[data-related-filter]').value = '';
  renderRelated(state.relatedPick);
  const live = $('[data-post-live]');
  live.hidden = !(p && p.published);
  if (p) live.href = `/guides/${p.slug}/`;
  $('[data-post-delete]').hidden = !p;
  $('[data-post-error]').hidden = true;
  state.dirty = false;
  show('guide-edit');
  if (!p) postForm.title.focus();
}
const updateMetaCount = () => { $('[data-meta-count]').textContent = `${postForm.metaDescription.value.length}/160 recommended`; };

postForm.addEventListener('input', (e) => {
  state.dirty = true;
  if (e.target === postForm.title && !state.postSlugTouched) postForm.slug.value = slugify(postForm.title.value);
  if (e.target === postForm.slug) { state.postSlugTouched = true; postForm.slug.value = postForm.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
  if ((e.target === postForm.title || e.target === postForm.slug) && !state.editingPost) {
    $('[data-post-slug-hint]').textContent = `Address: /guides/${postForm.slug.value || '…'}/ — cannot be changed later`;
  }
  if (e.target === postForm.metaDescription) updateMetaCount();
});
rte.addEventListener('input', () => { state.dirty = true; });

// Paste as plain text so formatting from Word/websites doesn't come along.
rte.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});
rte.addEventListener('focus', () => { document.execCommand('defaultParagraphSeparator', false, 'p'); });

// Toolbar
const blockOf = (node) => {
  while (node && node !== rte) {
    if (node.nodeType === 1 && /^(P|H2|H3|H4|LI|BLOCKQUOTE)$/.test(node.tagName)) return node;
    node = node.parentNode;
  }
  return null;
};
$('.rte-toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // keep selection
$('.rte-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  rte.focus();
  const cmd = b.getAttribute('data-cmd');
  if (cmd === 'link') {
    const url = prompt('Link to (e.g. /moisture-meters/ or https://…):', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|\/|mailto:|tel:)/i.test(url.trim())) { toast('Links must start with https://, / , mailto: or tel:', true); return; }
    document.execCommand('createLink', false, url.trim());
  } else if (cmd === 'note') {
    let block = blockOf(window.getSelection().anchorNode);
    if (!block || block.tagName !== 'P') { document.execCommand('formatBlock', false, 'p'); block = blockOf(window.getSelection().anchorNode); }
    if (block) block.classList.toggle('note');
  } else if (cmd === 'formatBlock') {
    document.execCommand('formatBlock', false, b.getAttribute('data-arg'));
  } else {
    document.execCommand(cmd, false, null);
  }
  state.dirty = true;
});
$('[data-post-image]').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('[data-post-status]');
  status.textContent = 'Uploading photo…';
  try {
    const up = await uploadImage(file, postForm.slug.value || 'guide');
    rte.focus();
    document.execCommand('insertHTML', false, `<p><img data-fsimg="${up.id}" src="${up.data}" alt="${esc(file.name.replace(/\.\w+$/, ''))}"></p><p><br></p>`);
    state.dirty = true;
    status.textContent = `Photo added (${up.kb} KB).`;
  } catch (x) {
    status.textContent = friendly(x);
    toast(friendly(x), true);
  }
});

postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-post-error]');
  err.hidden = true;
  try {
    const title = postForm.title.value.trim().slice(0, 160);
    if (!title) throw new Error('A title is required.');
    const slug = state.editingPost ? state.editingPost.slug : postForm.slug.value.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('The URL slug may only use lowercase letters, numbers and single hyphens.');
    if (!state.editingPost && state.posts.some((p) => p.slug === slug)) throw new Error(`Another guide already uses "${slug}".`);
    const body = editorToBody();
    if (!body.replace(/<[^>]+>/g, '').trim()) throw new Error('Write something in the guide first.');
    if (body.length > 900000) throw new Error('This guide is too long to store. Split it into two guides.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postForm.date.value)) throw new Error('Pick a date.');
    const excerpt = postForm.excerpt.value.trim().slice(0, 400);
    const data = {
      title,
      excerpt,
      metaDescription: (postForm.metaDescription.value.trim() || excerpt).slice(0, 300),
      date: postForm.date.value,
      published: postForm.published.checked,
      related: [...new Set([...(state.relatedPick || []), ...selectedRelated()])],
      body,
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'posts', slug), data);
    await loadPosts();
    state.dirty = false;
    markPending();
    toast(`Guide saved${data.published ? '' : ' as a draft'}. Click Publish to update the website.`);
    location.hash = '#/guides';
  } catch (x) {
    err.textContent = friendly(x);
    err.hidden = false;
  }
});
$('[data-post-delete]').addEventListener('click', async () => {
  const p = state.editingPost;
  if (!p || !confirm(`Delete the guide "${p.title}"? It will be removed from the website when you publish.`)) return;
  try {
    await deleteDoc(doc(db, 'posts', p.slug));
    state.posts = state.posts.filter((x) => x.slug !== p.slug);
    state.dirty = false;
    markPending();
    toast('Guide deleted. Click Publish to update the website.');
    location.hash = '#/guides';
  } catch (x) { toast(friendly(x), true); }
});

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
    else if (el.name === 'lowStockAt') el.value = Number.isFinite(s.lowStockAt) ? s.lowStockAt : 3;
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
      lowStockAt: Math.max(0, Math.floor(Number(f.lowStockAt.value) || 0)),
      address: {
        street: f['address.street'].value.trim(), city: f['address.city'].value.trim(), region: f['address.region'].value.trim(),
        postalCode: f['address.postalCode'].value.trim(), country: f['address.country'].value.trim().toUpperCase(),
      },
      updatedAt: serverTimestamp(),
    };
    await Promise.all([setDoc(doc(db, 'settings', 'site'), site), setDoc(doc(db, 'settings', 'private'), { deployHook: hook })]);
    state.settings = { ...state.settings, ...site };
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
    let m = /^#\/edit\/(.+)$/.exec(h);
    if (m) {
      const p = state.products.find((x) => x.slug === decodeURIComponent(m[1]));
      if (p) return openEditor(p);
    }
    m = /^#\/duplicate\/(.+)$/.exec(h);
    if (m) {
      const p = state.products.find((x) => x.slug === decodeURIComponent(m[1]));
      if (p) return openEditor(null, p);
    }
    if (h === '#/overview') { show('overview'); await Promise.all([loadOrders(), loadMessages()]); renderOverview(); return; }
    if (h === '#/orders') { show('orders'); await loadOrders(); renderOrders(); return; }
    if (h === '#/messages') { show('messages'); await loadMessages(); renderMessages(); return; }
    if (h === '#/discounts') { show('discounts'); $('[data-coupon-editor]').hidden = true; await loadCoupons(); renderCoupons(); return; }
    if (h === '#/guides') { show('guides'); await loadPosts(); renderPosts(); return; }
    if (h === '#/guide-new') return openPost(null);
    m = /^#\/guide\/(.+)$/.exec(h);
    if (m) {
      if (!state.posts.length) await loadPosts();
      const p = state.posts.find((x) => x.slug === decodeURIComponent(m[1]));
      if (p) return openPost(p);
      location.hash = '#/guides';
      return;
    }
    if (h === '#/categories') { show('categories'); renderCategories(); return; }
    if (h === '#/customers') { show('customers'); await loadOrders(); renderCustomers(); return; }
    if (h === '#/settings') { show('settings'); await openSettings(); return; }
    renderList();
    show('list');
  } catch (x) {
    toast(friendly(x), true);
  }
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const leavingEditor = /^#\/(new|edit\/|duplicate\/|guide-new|guide\/)/.test(lastHash);
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
  await Promise.all([
    loadProducts(),
    getDoc(doc(db, 'settings', 'site')).then((s) => { state.settings = s.exists() ? s.data() : {}; }).catch(() => {}),
  ]);
  // Badges for new orders/messages (ignore failures, e.g. before the first order exists).
  Promise.all([loadOrders(), loadMessages()]).catch(() => {});
  await route();
}
