// U-farm client script: menu, cart drawer + cart page, WhatsApp checkout,
// listing sort/filter, search and contact form.
(function () {
  'use strict';

  var CART_KEY = 'ufarm-cart';
  var CUSTOMER_KEY = 'ufarm-customer';
  var LAST_ORDER_KEY = 'ufarm-last-order';
  var catalogPromise;

  // ---------- data ----------
  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/products.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          data.bySlug = {};
          data.products.forEach(function (p) { data.bySlug[p.slug] = p; });
          return data;
        });
    }
    return catalogPromise;
  }

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable (private mode etc.) */ }
  }

  function money(n, currency) {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 0 }).format(n);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- cart state ----------
  var readCart = function () { return load(CART_KEY, {}); };

  function saveCart(cart) {
    store(CART_KEY, cart);
    updateCount();
    rerender();
  }

  function setQty(slug, qty) {
    var cart = readCart();
    if (qty <= 0) delete cart[slug];
    else cart[slug] = Math.min(99, qty);
    saveCart(cart);
  }

  function updateCount() {
    var cart = readCart();
    var n = Object.keys(cart).reduce(function (sum, k) { return sum + cart[k]; }, 0);
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  function cartLines(data) {
    var cart = readCart();
    var lines = Object.keys(cart)
      .filter(function (s) { return data.bySlug[s]; })
      .map(function (s) {
        var p = data.bySlug[s];
        return { p: p, qty: cart[s], total: p.price * cart[s] };
      });
    var subtotal = lines.reduce(function (sum, l) { return sum + l.total; }, 0);
    var count = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
    return { lines: lines, subtotal: subtotal, count: count };
  }

  // ---------- shared cart markup ----------
  function lineHtml(l, cur) {
    var s = l.p.slug;
    return '<li class="line">' +
      '<a class="line-img" href="' + l.p.url + '"><img src="' + l.p.image + '" alt="" width="80" height="60"></a>' +
      '<div class="line-info"><a class="line-name" href="' + l.p.url + '">' + esc(l.p.name) + '</a>' +
      '<span class="line-meta">' + esc(l.p.sku) + ' &middot; ' + money(l.p.price, cur) + ' each</span>' +
      '<div class="line-actions"><div class="stepper">' +
      '<button type="button" data-cart-dec="' + s + '" aria-label="Decrease quantity of ' + esc(l.p.name) + '">&minus;</button>' +
      '<input type="number" min="1" max="99" value="' + l.qty + '" data-cart-qty="' + s + '" aria-label="Quantity of ' + esc(l.p.name) + '">' +
      '<button type="button" data-cart-inc="' + s + '" aria-label="Increase quantity of ' + esc(l.p.name) + '">+</button>' +
      '</div><button type="button" class="remove" data-cart-remove="' + s + '">Remove</button></div></div>' +
      '<strong class="line-total">' + money(l.total, cur) + '</strong></li>';
  }

  function shippingHtml(st, subtotal) {
    var limit = st.freeShippingOver;
    if (!limit) return '';
    var pct = Math.min(100, Math.round((subtotal / limit) * 100));
    var msg = subtotal >= limit
      ? '<strong>You qualify for free shipping!</strong>'
      : 'Add <strong>' + money(limit - subtotal, st.currency) + '</strong> more for free shipping';
    return '<div class="ship-bar"><p>' + msg + '</p><div class="ship-track"><span style="width:' + pct + '%"></span></div></div>';
  }

  function emptyHtml() {
    var last = load(LAST_ORDER_KEY, null);
    return '<div class="cart-empty"><p>Your cart is empty.</p>' +
      (last ? '<p class="last-order">Your last order <strong>' + esc(last.ref) + '</strong> was prepared for WhatsApp. <a href="' + esc(last.url) + '" target="_blank" rel="noopener">Resend it</a> if it did not go through.</p>' : '') +
      '<p><a class="btn" href="/moisture-meters/">Shop moisture meters</a> <a class="btn btn-ghost" href="/shop/">Shop all</a></p></div>';
  }

  // ---------- cart drawer (every page) ----------
  var drawer, lastFocus;

  function buildDrawer() {
    drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="drawer-overlay" data-drawer-close></div>' +
      '<aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title">' +
      '<header class="drawer-head"><h2 id="drawer-title">Your cart</h2>' +
      '<button type="button" class="drawer-x" data-drawer-close aria-label="Close cart">&times;</button></header>' +
      '<div class="drawer-body" data-drawer-body></div></aside>';
    document.body.appendChild(drawer);
  }

  function renderDrawer() {
    if (!drawer || drawer.hidden) return;
    var body = drawer.querySelector('[data-drawer-body]');
    catalog().then(function (data) {
      var c = cartLines(data);
      var cur = data.store.currency;
      drawer.querySelector('#drawer-title').textContent = 'Your cart (' + c.count + ')';
      if (!c.lines.length) { body.innerHTML = emptyHtml(); return; }
      body.innerHTML =
        shippingHtml(data.store, c.subtotal) +
        '<ul class="lines">' + c.lines.map(function (l) { return lineHtml(l, cur); }).join('') + '</ul>' +
        '<div class="drawer-foot"><p class="subtotal"><span>Subtotal</span><strong>' + money(c.subtotal, cur) + '</strong></p>' +
        '<p class="small">Delivery cost is confirmed on WhatsApp.</p>' +
        '<a class="btn btn-lg btn-block btn-accent" href="/cart/#checkout">Checkout on WhatsApp</a>' +
        '<button type="button" class="btn btn-ghost btn-block" data-drawer-close>Continue shopping</button></div>';
    });
  }

  function openDrawer() {
    if (document.querySelector('[data-cart]')) return; // already on the cart page
    if (!drawer) buildDrawer();
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.classList.add('no-scroll');
    requestAnimationFrame(function () { drawer.classList.add('open'); });
    drawer.querySelector('.drawer-x').focus();
    renderDrawer();
  }

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('open');
    document.body.classList.remove('no-scroll');
    setTimeout(function () { drawer.hidden = true; }, 250);
    if (lastFocus) lastFocus.focus();
  }

  // ---------- cart page + checkout ----------
  function renderCartPage(root) {
    catalog().then(function (data) {
      var c = cartLines(data);
      var st = data.store;
      var cur = st.currency;
      if (!c.lines.length) { root.innerHTML = emptyHtml(); return; }

      // Keep a half-filled form when quantities change.
      var form = root.querySelector('[data-checkout]');
      var draft = form ? formValues(form) : load(CUSTOMER_KEY, {});

      root.innerHTML =
        '<div class="cart-layout">' +
        '<div class="cart-items">' + shippingHtml(st, c.subtotal) +
        '<ul class="lines">' + c.lines.map(function (l) { return lineHtml(l, cur); }).join('') + '</ul>' +
        '<p class="cart-links"><a href="/shop/">&larr; Continue shopping</a> <button type="button" class="remove" data-cart-clear>Clear cart</button></p></div>' +
        '<div class="checkout" id="checkout">' +
        '<div class="cart-summary"><h2>Order summary</h2>' +
        '<p class="subtotal"><span>Items (' + c.count + ')</span><span>' + money(c.subtotal, cur) + '</span></p>' +
        '<p class="subtotal"><span>Delivery</span><span>' + (st.freeShippingOver && c.subtotal >= st.freeShippingOver ? 'Free' : 'Confirmed on WhatsApp') + '</span></p>' +
        '<p class="subtotal total"><span>Subtotal</span><strong>' + money(c.subtotal, cur) + '</strong></p></div>' +
        '<form class="form" data-checkout novalidate>' +
        '<h2>Delivery details</h2>' +
        field('name', 'Full name', 'text', 'name', true) +
        field('phone', 'Phone / WhatsApp number', 'tel', 'tel', true) +
        field('address', 'Delivery address', 'text', 'street-address', true) +
        field('city', 'Town / city & region', 'text', 'address-level2', true) +
        '<label>Payment method<select name="payment">' +
        st.paymentMethods.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') +
        '</select></label>' +
        '<label>Order notes (optional)<textarea name="notes" rows="3" placeholder="Delivery instructions, crop you are testing, questions…"></textarea></label>' +
        '<p class="form-error" data-form-error hidden></p>' +
        '<button class="btn btn-lg btn-block btn-wa" type="submit">' + waIcon + ' Send order on WhatsApp</button>' +
        '<p class="small">WhatsApp opens with your order filled in — just press send. We reply with delivery cost and payment details. Nothing is charged yet.</p>' +
        '</form></div></div>';

      fillForm(root.querySelector('[data-checkout]'), draft);
      if (location.hash === '#checkout' && !root.dataset.scrolled) {
        root.dataset.scrolled = '1';
        document.getElementById('checkout').scrollIntoView({ block: 'start' });
      }
    });
  }

  var waIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

  function field(name, label, type, autocomplete, required) {
    return '<label><span>' + label + (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</span>' +
      '<input name="' + name + '" type="' + type + '" autocomplete="' + autocomplete + '"' + (required ? ' required' : '') + '></label>';
  }

  function formValues(form) {
    var v = {};
    new FormData(form).forEach(function (val, key) { v[key] = String(val).trim(); });
    return v;
  }

  function fillForm(form, values) {
    Object.keys(values || {}).forEach(function (k) {
      if (form.elements[k] && values[k]) form.elements[k].value = values[k];
    });
  }

  function orderRef() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return 'UF-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function orderMessage(data, c, v, ref) {
    var st = data.store;
    var cur = st.currency;
    var free = st.freeShippingOver && c.subtotal >= st.freeShippingOver;
    var out = [
      '*New order - ' + st.name + '*',
      'Order ref: *' + ref + '*',
      '',
      '*Items*',
    ];
    c.lines.forEach(function (l, i) {
      out.push((i + 1) + '. ' + l.p.name + ' (' + l.p.sku + ')');
      out.push('   ' + l.qty + ' x ' + money(l.p.price, cur) + ' = ' + money(l.total, cur));
    });
    out.push(
      '',
      'Items: ' + c.count,
      '*Subtotal: ' + money(c.subtotal, cur) + '*',
      'Delivery: ' + (free ? 'Free (order over ' + money(st.freeShippingOver, cur) + ')' : 'Please confirm cost'),
      '',
      '*Customer details*',
      'Name: ' + v.name,
      'Phone: ' + v.phone,
      'Address: ' + v.address,
      'Town/City: ' + v.city,
      'Payment: ' + v.payment
    );
    if (v.notes) out.push('Notes: ' + v.notes);
    out.push('', 'Please confirm availability, delivery cost and payment details. Thank you!');
    return out.join('\n');
  }

  function submitCheckout(form) {
    var errorEl = form.querySelector('[data-form-error]');
    var missing = Array.prototype.filter.call(form.querySelectorAll('[required]'), function (el) {
      el.setAttribute('aria-invalid', !el.value.trim());
      return !el.value.trim();
    });
    var phone = form.elements.phone;
    var phoneOk = (phone.value.match(/\d/g) || []).length >= 7;
    if (phone.value.trim() && !phoneOk) phone.setAttribute('aria-invalid', 'true');
    if (missing.length || !phoneOk) {
      errorEl.textContent = missing.length ? 'Please fill in all required fields.' : 'Please enter a valid phone number.';
      errorEl.hidden = false;
      (missing[0] || phone).focus();
      return;
    }
    errorEl.hidden = true;

    catalog().then(function (data) {
      var c = cartLines(data);
      if (!c.lines.length) return;
      var v = formValues(form);
      var ref = orderRef();
      var url = 'https://wa.me/' + data.store.whatsapp + '?text=' + encodeURIComponent(orderMessage(data, c, v, ref));

      store(CUSTOMER_KEY, { name: v.name, phone: v.phone, address: v.address, city: v.city, payment: v.payment });
      store(LAST_ORDER_KEY, { ref: ref, url: url, at: Date.now() });

      var win = window.open(url, '_blank');
      if (win) win.opener = null;
      else location.href = url; // pop-up blocked: open in this tab

      store(CART_KEY, {});
      updateCount();
      var root = document.querySelector('[data-cart]');
      root.innerHTML =
        '<div class="order-done">' + waIcon +
        '<h2>Your order is ready in WhatsApp</h2>' +
        '<p>Order reference <strong>' + esc(ref) + '</strong>. Press <strong>send</strong> in WhatsApp and our team will reply with delivery cost and payment details.</p>' +
        '<p><a class="btn btn-lg btn-wa" href="' + esc(url) + '" target="_blank" rel="noopener">' + waIcon + ' Open WhatsApp again</a> ' +
        '<a class="btn btn-lg btn-ghost" href="/shop/">Continue shopping</a></p></div>';
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function rerender() {
    renderDrawer();
    var root = document.querySelector('[data-cart]');
    if (root && !root.querySelector('.order-done')) renderCartPage(root);
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    var el;

    if ((el = t.closest('[data-add-to-cart]'))) {
      var slug = el.getAttribute('data-add-to-cart');
      var qtyInput = el.closest('.product-info') && document.querySelector('[data-qty]');
      var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      var cart = readCart();
      cart[slug] = Math.min(99, (cart[slug] || 0) + qty);
      el.classList.add('added');
      if (el.classList.contains('icon-btn')) {
        setTimeout(function () { el.classList.remove('added'); }, 1400);
      } else {
        var label = el.innerHTML;
        el.textContent = 'Added ✓';
        setTimeout(function () { el.classList.remove('added'); el.innerHTML = label; }, 1400);
      }
      saveCart(cart);
      openDrawer();
      return;
    }
    if ((el = t.closest('.cart-link')) && !document.querySelector('[data-cart]')) {
      e.preventDefault();
      openDrawer();
      return;
    }
    if ((el = t.closest('[data-qty-step]'))) {
      var q = document.querySelector('[data-qty]');
      q.value = Math.min(99, Math.max(1, (parseInt(q.value, 10) || 1) + Number(el.getAttribute('data-qty-step'))));
      return;
    }
    if (t.closest('[data-drawer-close]')) { closeDrawer(); return; }
    if ((el = t.closest('[data-cart-inc]'))) { var s1 = el.getAttribute('data-cart-inc'); setQty(s1, (readCart()[s1] || 0) + 1); return; }
    if ((el = t.closest('[data-cart-dec]'))) { var s2 = el.getAttribute('data-cart-dec'); setQty(s2, (readCart()[s2] || 0) - 1); return; }
    if ((el = t.closest('[data-cart-remove]'))) { setQty(el.getAttribute('data-cart-remove'), 0); return; }
    if (t.closest('[data-cart-clear]')) {
      if (confirm('Remove all items from your cart?')) saveCart({});
      return;
    }
    if (drawer && !drawer.hidden && t.closest('.drawer-panel a[href]')) closeDrawer();
  });

  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-cart-qty]');
    if (input) setQty(input.getAttribute('data-cart-qty'), Math.max(1, parseInt(input.value, 10) || 1));
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-checkout]');
    if (!form) return;
    e.preventDefault();
    submitCheckout(form);
  });

  document.addEventListener('keydown', function (e) {
    if (!drawer || drawer.hidden) return;
    if (e.key === 'Escape') closeDrawer();
    if (e.key === 'Tab') { // keep focus inside the drawer
      var f = drawer.querySelectorAll('a[href], button, input, select, textarea');
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Keep the cart in sync across open tabs.
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) { updateCount(); rerender(); }
  });

  // ---------- listing sort / filter ----------
  function setupListing(root) {
    var grid = root.querySelector('.products');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.children);
    var sortSel = root.querySelector('[data-sort]');
    var filterSel = root.querySelector('[data-filter]');
    var countEl = root.querySelector('[data-count]');

    var params = new URLSearchParams(location.search);
    if (filterSel && params.get('category')) filterSel.value = params.get('category');

    function apply() {
      var sorted = cards.slice();
      var mode = sortSel ? sortSel.value : '';
      if (mode === 'price-asc') sorted.sort(function (a, b) { return a.dataset.price - b.dataset.price; });
      if (mode === 'price-desc') sorted.sort(function (a, b) { return b.dataset.price - a.dataset.price; });
      if (mode === 'name') sorted.sort(function (a, b) { return a.dataset.name.localeCompare(b.dataset.name); });
      var cat = filterSel ? filterSel.value : '';
      var shown = 0;
      sorted.forEach(function (c) {
        var show = !cat || c.dataset.category === cat;
        c.hidden = !show;
        if (show) shown++;
        grid.appendChild(c);
      });
      if (countEl) countEl.textContent = shown + ' product' + (shown === 1 ? '' : 's');
    }
    if (sortSel) sortSel.addEventListener('change', apply);
    if (filterSel) filterSel.addEventListener('change', apply);
    apply();
  }

  // ---------- search ----------
  function renderSearch(root) {
    var q = (new URLSearchParams(location.search).get('q') || '').trim();
    document.querySelectorAll('input[name="q"]').forEach(function (input) { input.value = q; });
    if (!q) { root.innerHTML = '<p class="muted">Type a product name, crop, brand or SKU above.</p>'; return; }
    catalog().then(function (data) {
      var cur = data.store.currency;
      var terms = q.toLowerCase().split(/\s+/);
      var hits = data.products.filter(function (p) {
        return terms.every(function (t) { return p.keywords.indexOf(t) !== -1; });
      });
      var heading = '<p class="toolbar count">' + hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for <strong>“' + esc(q) + '”</strong></p>';
      if (!hits.length) {
        root.innerHTML = heading + '<p>Try a broader word like “cocoa”, “grain”, “hay”, “sprayer” or “pump”, or <a href="/contact/">ask us</a> — we may be able to source it.</p>';
        return;
      }
      var cartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/><path d="M13.5 9.5v4M11.5 11.5h4"/></svg>';
      root.innerHTML = heading + '<div class="grid products">' + hits.map(function (p) {
        var out = p.stock === 'OutOfStock';
        var off = p.oldPrice ? Math.round((p.oldPrice - p.price) / p.oldPrice * 100) : 0;
        var tag = out ? '<span class="tag tag-out">Out of stock</span>' : p.stock === 'PreOrder' ? '<span class="tag tag-pre">Pre-order</span>' : off ? '<span class="tag tag-sale">-' + off + '%</span>' : '';
        return '<article class="pcard"><a class="pcard-media" href="' + p.url + '" tabindex="-1" aria-hidden="true"><img src="' + p.image + '" alt="' + esc(p.name) + '" width="400" height="300" loading="lazy">' + tag + '</a>' +
          '<div class="pcard-body"><p class="pcard-meta">' + (p.brand ? '<b>' + esc(p.brand) + '</b> · ' : '') + '<a href="' + p.subUrl + '">' + esc(p.sub) + '</a></p>' +
          '<h3 class="pcard-title"><a href="' + p.url + '">' + esc(p.name) + '</a></h3>' +
          '<p class="pcard-text">' + esc(p.short) + '</p><div class="pcard-foot"><p class="price">' + money(p.price, cur) + (p.oldPrice ? ' <s>' + money(p.oldPrice, cur) + '</s>' : '') + '</p>' +
          '<button class="icon-btn" data-add-to-cart="' + p.slug + '" aria-label="Add ' + esc(p.name) + ' to cart"' + (out ? ' disabled' : '') + '>' + cartIcon + '</button></div></div></article>';
      }).join('') + '</div>';
    });
  }

  // ---------- contact form (no backend: opens the visitor's email app) ----------
  function setupContact(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(form);
      var mail = document.querySelector('.site-footer a[href^="mailto:"]');
      var to = mail ? mail.getAttribute('href') : 'mailto:';
      var body = 'Name: ' + f.get('name') + '\nEmail: ' + f.get('email') + '\nPhone: ' + (f.get('phone') || '-') + '\n\n' + f.get('message');
      location.href = to + '?subject=' + encodeURIComponent('Website enquiry: ' + f.get('topic')) + '&body=' + encodeURIComponent(body);
      var note = form.querySelector('[data-form-note]');
      note.textContent = 'Your email app should open with your message ready to send. If it does not, email us directly.';
      note.hidden = false;
    });
  }

  // ---------- mobile menu ----------
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  var scrim = document.querySelector('[data-nav-scrim]');
  var mobile = window.matchMedia('(max-width: 1180px)');
  function setNav(open) {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
    scrim.hidden = !open;
    document.body.classList.toggle('no-scroll', open);
    if (open) nav.querySelector('.nav-close').focus();
    else toggle.focus();
  }
  if (toggle && nav && scrim) {
    toggle.addEventListener('click', function () { setNav(true); });
    nav.querySelector('.nav-close').addEventListener('click', function () { setNav(false); });
    scrim.addEventListener('click', function () { setNav(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) setNav(false);
    });
    // In the mobile menu, department links open their sub-list first.
    nav.addEventListener('click', function (e) {
      var link = e.target.closest('.has-mega > .nav-link');
      if (!link || !mobile.matches) return;
      var item = link.parentElement;
      if (!item.classList.contains('open')) {
        e.preventDefault();
        nav.querySelectorAll('.nav-item.open').forEach(function (n) { if (n !== item) n.classList.remove('open'); });
        item.classList.add('open');
      }
    });
    mobile.addEventListener('change', function (m) { if (!m.matches && nav.classList.contains('open')) setNav(false); });
  }

  // ---------- init ----------
  updateCount();
  document.querySelectorAll('[data-listing]').forEach(setupListing);
  var cartRoot = document.querySelector('[data-cart]');
  if (cartRoot) renderCartPage(cartRoot);
  var searchRoot = document.querySelector('[data-search-results]');
  if (searchRoot) renderSearch(searchRoot);
  var contact = document.querySelector('[data-contact-form]');
  if (contact) setupContact(contact);
})();
