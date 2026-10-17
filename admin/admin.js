// U-farm admin panel. Talks to the JSON API in server.js.
// Routes: #/ (list), #/new, #/edit/<slug>
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var state = { meta: null, products: [], editing: null, dirty: false, slugTouched: false };

  // ---------- API ----------
  function api(method, url, body) {
    return fetch('/admin/api/' + url, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Ufarm-Admin': '1' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && url !== 'login') { showLogin(); throw new Error('Please log in again.'); }
        if (!r.ok) throw new Error(data.error || 'Request failed (' + r.status + ')');
        return data;
      });
    });
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: state.meta.currency, maximumFractionDigits: 0 }).format(n);
  }
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function imageOf(p) { return p.image || '/assets/img/products/' + p.art + '.svg'; }
  function catName(slug) { var c = state.meta.categories.find(function (x) { return x.slug === slug; }); return c ? c.name : slug; }
  function subName(cat, sub) {
    var c = state.meta.categories.find(function (x) { return x.slug === cat; });
    var s = c && c.subs.find(function (x) { return x.slug === sub; });
    return s ? s.name : sub;
  }
  var STOCK = { InStock: 'In stock', PreOrder: 'Pre-order', OutOfStock: 'Out of stock' };

  var toastTimer;
  function toast(msg, isError) {
    var t = $('[data-toast]');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 3000);
  }

  function show(view) {
    document.querySelectorAll('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
    $('[data-authed]').hidden = view === 'login';
    window.scrollTo(0, 0);
  }

  // ---------- login ----------
  function showLogin() {
    show('login');
    setTimeout(function () { $('[data-login] input').focus(); }, 0);
  }

  $('[data-login]').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var err = $('[data-login-error]');
    err.hidden = true;
    api('POST', 'login', { password: form.password.value })
      .then(function () { form.reset(); return start(); })
      .catch(function (x) { err.textContent = x.message; err.hidden = false; });
  });

  $('[data-logout]').addEventListener('click', function () {
    api('POST', 'logout').finally(showLogin);
  });

  // ---------- list ----------
  function renderList() {
    var q = $('[data-search]').value.trim().toLowerCase();
    var cat = $('[data-filter-cat]').value;
    var stock = $('[data-filter-stock]').value;
    var rows = state.products.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (stock && p.stock !== stock) return false;
      if (q && (p.name + ' ' + p.sku + ' ' + (p.brand || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $('[data-rows]').innerHTML = rows.map(function (p) {
      return '<tr>' +
        '<td><img class="thumb" src="' + esc(imageOf(p)) + '" alt="" loading="lazy"></td>' +
        '<td><a class="pname" href="#/edit/' + esc(p.slug) + '">' + esc(p.name) + '</a><div class="sub">' + esc(p.sku) + (p.brand ? ' · ' + esc(p.brand) : '') + '</div></td>' +
        '<td>' + esc(catName(p.category)) + '<div class="sub">' + esc(subName(p.category, p.sub)) + '</div></td>' +
        '<td class="num">' + money(p.price) + (p.oldPrice ? '<div class="sub"><s>' + money(p.oldPrice) + '</s></div>' : '') + '</td>' +
        '<td><span class="pill ' + esc(p.stock) + '">' + STOCK[p.stock] + '</span></td>' +
        '<td><button type="button" class="star' + (p.featured ? ' on' : '') + '" data-star="' + esc(p.slug) + '" aria-label="' + (p.featured ? 'Remove from' : 'Add to') + ' home page" title="Featured on home page">★</button></td>' +
        '<td><div class="actions"><a href="#/edit/' + esc(p.slug) + '">Edit</a><a href="/products/' + esc(p.slug) + '/" target="_blank" rel="noopener">View</a></div></td>' +
        '</tr>';
    }).join('');
    $('[data-empty]').hidden = rows.length > 0;
    var out = state.products.filter(function (p) { return p.stock === 'OutOfStock'; }).length;
    var feat = state.products.filter(function (p) { return p.featured; }).length;
    $('[data-stats]').textContent = state.products.length + ' products · ' + feat + ' featured · ' + out + ' out of stock';
  }

  ['[data-search]', '[data-filter-cat]', '[data-filter-stock]'].forEach(function (s) {
    $(s).addEventListener('input', renderList);
  });

  $('[data-rows]').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-star]');
    if (!btn) return;
    var p = state.products.find(function (x) { return x.slug === btn.getAttribute('data-star'); });
    var next = Object.assign({}, p, { featured: !p.featured });
    btn.disabled = true;
    api('PUT', 'products/' + encodeURIComponent(p.slug), next)
      .then(function (saved) {
        replaceProduct(saved);
        renderList();
        toast(saved.featured ? 'Now featured on the home page.' : 'Removed from the home page.');
      })
      .catch(function (x) { toast(x.message, true); btn.disabled = false; });
  });

  $('[data-new]').addEventListener('click', function () { location.hash = '#/new'; });

  function replaceProduct(saved) {
    var i = state.products.findIndex(function (x) { return x.slug === saved.slug; });
    if (i === -1) state.products.unshift(saved);
    else state.products[i] = saved;
  }

  // ---------- editor ----------
  var form = $('[data-editor]');

  function fillSubs(catSlug, selected) {
    var c = state.meta.categories.find(function (x) { return x.slug === catSlug; }) || state.meta.categories[0];
    form.sub.innerHTML = c.subs.map(function (s) {
      return '<option value="' + esc(s.slug) + '"' + (s.slug === selected ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
  }

  function setPhoto(src) {
    form.image.value = src || '';
    var img = $('[data-photo-img]');
    if (src) { img.src = src; }
    img.hidden = !src;
    $('[data-photo-empty]').hidden = !!src;
    $('[data-remove-photo]').hidden = !src;
    $('[data-art-wrap]').hidden = !!src;
  }

  function openEditor(p) {
    state.editing = p || null;
    state.slugTouched = !!p;
    var isNew = !p;
    p = p || { stock: 'InStock', category: state.meta.categories[0].slug, art: 'meter-cup', specs: {}, description: [], features: [], uses: [] };

    $('[data-edit-title]').textContent = isNew ? 'Add product' : 'Edit product';
    form.reset();
    form.name.value = p.name || '';
    form.slug.value = p.slug || '';
    form.slug.readOnly = !isNew;
    $('[data-slug-hint]').innerHTML = isNew
      ? 'Page address: /products/<b data-slug-preview>' + esc(p.slug || '…') + '</b>/ — cannot be changed later'
      : 'Page address is fixed: /products/' + esc(p.slug) + '/';
    form.sku.value = p.sku || '';
    form.brand.value = p.brand || '';
    form.category.value = p.category;
    fillSubs(p.category, p.sub);
    form.short.value = p.short || '';
    form.description.value = (p.description || []).join('\n\n');
    form.features.value = (p.features || []).join('\n');
    form.specs.value = Object.keys(p.specs || {}).map(function (k) { return k + ': ' + p.specs[k]; }).join('\n');
    form.uses.value = (p.uses || []).join('\n');
    form.art.value = p.art || 'meter-cup';
    form.price.value = p.price != null ? p.price : '';
    form.oldPrice.value = p.oldPrice || '';
    form.stock.value = p.stock || 'InStock';
    form.featured.checked = !!p.featured;
    setPhoto(p.image);
    updateShortCount();

    var live = $('[data-view-live]');
    live.hidden = isNew;
    if (!isNew) live.href = '/products/' + p.slug + '/';
    $('[data-delete]').hidden = isNew;
    $('[data-form-error]').hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    $('[data-upload-status]').textContent = 'JPG, PNG or WebP. Large photos are resized automatically.';
    state.dirty = false;
    show('edit');
    if (isNew) form.name.focus();
  }

  function updateShortCount() {
    $('[data-short-count]').textContent = form.short.value.length + '/300';
  }

  form.addEventListener('input', function (e) {
    state.dirty = true;
    if (e.target === form.name && !state.slugTouched) form.slug.value = slugify(form.name.value);
    if (e.target === form.slug) { state.slugTouched = true; form.slug.value = form.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); }
    if (e.target === form.name || e.target === form.slug) {
      var prev = $('[data-slug-preview]');
      if (prev) prev.textContent = form.slug.value || '…';
    }
    if (e.target === form.short) updateShortCount();
    if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid');
  });
  form.category.addEventListener('change', function () { fillSubs(form.category.value); });

  function collect() {
    var specs = {};
    form.specs.value.split('\n').forEach(function (line) {
      var i = line.indexOf(':');
      if (i > 0) {
        var k = line.slice(0, i).trim();
        var v = line.slice(i + 1).trim();
        if (k && v) specs[k] = v;
      }
    });
    var lines = function (v) { return v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); };
    return {
      name: form.name.value,
      slug: form.slug.value,
      sku: form.sku.value,
      brand: form.brand.value,
      category: form.category.value,
      sub: form.sub.value,
      short: form.short.value,
      description: form.description.value.split(/\n\s*\n/).map(function (s) { return s.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean),
      features: lines(form.features.value),
      specs: specs,
      uses: lines(form.uses.value),
      image: form.image.value,
      art: form.art.value,
      price: form.price.value,
      oldPrice: form.oldPrice.value,
      stock: form.stock.value,
      featured: form.featured.checked,
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('[data-form-error]');
    var missing = Array.prototype.filter.call(form.querySelectorAll('[required]'), function (el) {
      var bad = !String(el.value).trim();
      if (bad) el.setAttribute('aria-invalid', 'true');
      return bad;
    });
    if (missing.length) {
      err.textContent = 'Please fill in the required fields (marked *).';
      err.hidden = false;
      missing[0].focus();
      return;
    }
    err.hidden = true;
    var btn = $('[data-save]');
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    var editing = state.editing;
    var req = editing
      ? api('PUT', 'products/' + encodeURIComponent(editing.slug), collect())
      : api('POST', 'products', collect());
    req.then(function (saved) {
      replaceProduct(saved);
      state.dirty = false;
      toast((editing ? 'Saved' : 'Added') + ' and published to the shop.');
      location.hash = '#/';
    }).catch(function (x) {
      err.textContent = x.message;
      err.hidden = false;
    }).finally(function () {
      btn.disabled = false;
      btn.innerHTML = 'Save &amp; publish';
    });
  });

  $('[data-delete]').addEventListener('click', function () {
    var p = state.editing;
    if (!p || !confirm('Delete "' + p.name + '"? Its page will be removed from the shop.')) return;
    api('DELETE', 'products/' + encodeURIComponent(p.slug)).then(function () {
      state.products = state.products.filter(function (x) { return x.slug !== p.slug; });
      state.dirty = false;
      toast('Product deleted.');
      location.hash = '#/';
    }).catch(function (x) { toast(x.message, true); });
  });

  $('[data-back]').addEventListener('click', function () { location.hash = '#/'; });

  // ---------- photo upload (resized in the browser) ----------
  function resize(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 1400;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process this image.')); }, 'image/webp', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
      img.src = url;
    });
  }
  function toDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read the image.')); };
      r.readAsDataURL(blob);
    });
  }

  $('[data-file]').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var status = $('[data-upload-status]');
    status.textContent = 'Uploading…';
    resize(file)
      .then(toDataUrl)
      .then(function (data) { return api('POST', 'upload', { name: form.slug.value || file.name, data: data }); })
      .then(function (r) {
        setPhoto(r.image);
        state.dirty = true;
        status.textContent = 'Photo uploaded. Click "Save & publish" to use it.';
      })
      .catch(function (x) { status.textContent = x.message; toast(x.message, true); });
  });

  $('[data-remove-photo]').addEventListener('click', function () {
    setPhoto('');
    state.dirty = true;
  });

  // ---------- routing ----------
  function route() {
    if (!state.meta) return;
    var h = location.hash;
    if (h === '#/new') return openEditor(null);
    var m = /^#\/edit\/(.+)$/.exec(h);
    if (m) {
      var p = state.products.find(function (x) { return x.slug === decodeURIComponent(m[1]); });
      if (p) return openEditor(p);
    }
    renderList();
    show('list');
  }

  var lastHash = location.hash;
  window.addEventListener('hashchange', function () {
    var leavingEditor = /^#\/(new|edit\/)/.test(lastHash);
    if (leavingEditor && state.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    state.dirty = false;
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- start ----------
  function start() {
    return Promise.all([api('GET', 'meta'), api('GET', 'products')]).then(function (r) {
      state.meta = r[0];
      state.products = r[1];
      document.querySelectorAll('[data-cur]').forEach(function (el) { el.textContent = state.meta.currencySymbol; });
      var catOpts = state.meta.categories.map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>'; }).join('');
      form.category.innerHTML = catOpts;
      $('[data-filter-cat]').innerHTML = '<option value="">All categories</option>' + catOpts;
      form.art.innerHTML = state.meta.artKeys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k.replace(/-/g, ' ')) + '</option>'; }).join('');
      route();
    });
  }

  api('GET', 'session').then(start).catch(function () { showLogin(); });
})();
