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

  // ---------- Firestore (orders + contact messages) ----------
  // Plain REST calls: no Firebase SDK needed on public pages.
  function fsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    var fields = {};
    Object.keys(v).forEach(function (k) { fields[k] = fsValue(v[k]); });
    return { mapValue: { fields: fields } };
  }
  function saveDoc(fb, collection, id, data) {
    if (!fb || !fb.projectId) return Promise.reject(new Error('Firebase not configured'));
    var url = 'https://firestore.googleapis.com/v1/projects/' + fb.projectId + '/databases/(default)/documents/' +
      collection + '?documentId=' + encodeURIComponent(id) + '&key=' + fb.apiKey;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fsValue(data).mapValue.fields }),
      keepalive: true, // still delivered if the page navigates to WhatsApp
    }).then(function (r) { if (!r.ok) throw new Error('Save failed (' + r.status + ')'); return r; });
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
        // Never more than the units in stock (when stock is tracked).
        var max = typeof p.qty === 'number' && p.stock === 'InStock' ? Math.max(1, p.qty) : 99;
        var qty = Math.min(cart[s], max);
        return { p: p, qty: qty, max: max, capped: cart[s] > max, total: p.price * qty };
      });
    var subtotal = lines.reduce(function (sum, l) { return sum + l.total; }, 0);
    var count = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
    var cp = couponFor(subtotal, data.store.currency);
    return {
      lines: lines, subtotal: subtotal, count: count,
      discount: cp.discount, couponCode: cp.discount && cp.coupon ? cp.coupon.code : '', total: subtotal - cp.discount,
    };
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
      '<input type="number" min="1" max="' + l.max + '" value="' + l.qty + '" data-cart-qty="' + s + '" aria-label="Quantity of ' + esc(l.p.name) + '">' +
      '<button type="button" data-cart-inc="' + s + '" aria-label="Increase quantity of ' + esc(l.p.name) + '"' + (l.qty >= l.max ? ' disabled' : '') + '>+</button>' +
      '</div><button type="button" class="remove" data-cart-remove="' + s + '">Remove</button></div>' +
      (l.qty >= l.max && l.max < 99 ? '<span class="line-note">Only ' + l.max + ' in stock</span>' : '') + '</div>' +
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
        couponHtml(c, cur) +
        '<p class="subtotal"><span>Delivery</span><span>' + (st.freeShippingOver && c.total >= st.freeShippingOver ? 'Free' : 'Confirmed on WhatsApp') + '</span></p>' +
        '<p class="subtotal total"><span>Total</span><strong>' + money(c.total, cur) + '</strong></p></div>' +
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

  // e.g. UF-261021-8K3QZP — 6 random characters, no look-alikes (0/O, 1/I).
  function orderRef() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var rnd = new Uint32Array(6);
    crypto.getRandomValues(rnd);
    var tail = Array.prototype.map.call(rnd, function (n) { return abc[n % abc.length]; }).join('');
    return 'UF-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + tail;
  }

  // ---------- discount codes ----------
  var COUPON_KEY = 'ufarm-coupon';
  var todayISO = function () { return new Date().toISOString().slice(0, 10); };

  // Discount for a subtotal, plus a reason when the code doesn't apply.
  function couponFor(subtotal, cur) {
    var cp = load(COUPON_KEY, null);
    if (!cp) return { coupon: null, discount: 0 };
    if (cp.expires && cp.expires < todayISO()) { store(COUPON_KEY, null); return { coupon: null, discount: 0, note: 'Code ' + cp.code + ' has expired.' }; }
    if (subtotal < (cp.minOrder || 0)) return { coupon: cp, discount: 0, note: 'Spend ' + money(cp.minOrder - subtotal, cur) + ' more to use ' + cp.code + '.' };
    var d = cp.type === 'percent' ? Math.round(subtotal * cp.value / 100) : cp.value;
    return { coupon: cp, discount: Math.max(0, Math.min(subtotal, d)) };
  }

  function couponHtml(c, cur) {
    var r = couponFor(c.subtotal, cur);
    var row = r.coupon && r.discount
      ? '<p class="subtotal discount-line"><span>Discount <b>' + esc(r.coupon.code) + '</b> <button type="button" class="remove" data-coupon-remove>Remove</button></span><span>−' + money(r.discount, cur) + '</span></p>'
      : '';
    return row +
      '<form class="coupon-form" data-coupon-form novalidate>' +
      '<label class="sr-only" for="coupon-code">Discount code</label>' +
      '<input id="coupon-code" name="code" placeholder="Discount code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30"' + (r.coupon ? ' value="' + esc(r.coupon.code) + '"' : '') + '>' +
      '<button type="submit" class="btn btn-sm btn-outline">Apply</button></form>' +
      '<p class="coupon-msg" data-coupon-msg' + (r.note ? '' : ' hidden') + '>' + esc(r.note || '') + '</p>';
  }

  // Reads one code from Firestore (codes can be fetched one at a time, never listed).
  function fetchCoupon(fb, code) {
    var url = 'https://firestore.googleapis.com/v1/projects/' + fb.projectId + '/databases/(default)/documents/coupons/' + encodeURIComponent(code) + '?key=' + fb.apiKey;
    return fetch(url).then(function (r) {
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw new Error('Could not check that code right now.');
      return r.json().then(function (doc) {
        var f = doc.fields || {};
        var num = function (k) { return f[k] ? Number(f[k].integerValue || f[k].doubleValue || 0) : 0; };
        return {
          code: code, type: f.type ? f.type.stringValue : 'percent', value: num('value'), minOrder: num('minOrder'),
          expires: f.expires ? f.expires.stringValue : '', active: f.active ? f.active.booleanValue : false,
          uses: num('uses'), maxUses: num('maxUses'),
        };
      });
    });
  }

  function applyCoupon(form) {
    var msg = document.querySelector('[data-coupon-msg]');
    var code = form.elements.code.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    var say = function (t) { msg.textContent = t; msg.hidden = false; };
    if (!code) { store(COUPON_KEY, null); rerender(); return; }
    form.querySelector('button').disabled = true;
    catalog().then(function (data) {
      return fetchCoupon(data.store.firebase, code).then(function (cp) {
        if (!cp || !cp.active) return say('That code is not valid.');
        if (cp.expires && cp.expires < todayISO()) return say('That code has expired.');
        if (cp.maxUses && cp.uses >= cp.maxUses) return say('That code has been fully used.');
        store(COUPON_KEY, { code: cp.code, type: cp.type, value: cp.value, minOrder: cp.minOrder, expires: cp.expires });
        rerender();
      });
    }).catch(function (e) { say(e.message); }).finally(function () { form.querySelector('button').disabled = false; });
  }

  // ---------- order tracking ----------
  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }
  var lastFour = function (phone) { return String(phone || '').replace(/\D/g, '').slice(-4); };
  var trackCheck = function (ref, phone) { return sha256(ref + ':' + lastFour(phone)); };

  // Saves the order and its public tracking record in one atomic write.
  // `exists: false` means an existing order can never be overwritten.
  function saveOrder(fb, ref, order, check) {
    var base = 'projects/' + fb.projectId + '/databases/(default)/documents/';
    var tracking = {
      ref: ref, status: 'new', createdAt: order.createdAt, updatedAt: order.createdAt,
      itemCount: order.itemCount, total: order.total, currency: order.currency, check: check,
      history: [{ status: 'new', at: order.createdAt }],
    };
    return fetch('https://firestore.googleapis.com/v1/' + base.replace(/\/$/, '') + ':commit?key=' + fb.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        writes: [
          { update: { name: base + 'orders/' + ref, fields: fsValue(order).mapValue.fields }, currentDocument: { exists: false } },
          { update: { name: base + 'tracking/' + ref, fields: fsValue(tracking).mapValue.fields }, currentDocument: { exists: false } },
        ],
      }),
    }).then(function (r) { if (!r.ok) throw new Error('Order save failed (' + r.status + ')'); });
  }

  // Counts one use of a discount code (best effort; never blocks the order).
  function useCoupon(fb, code) {
    var name = 'projects/' + fb.projectId + '/databases/(default)/documents/coupons/' + code;
    return fetch('https://firestore.googleapis.com/v1/projects/' + fb.projectId + '/databases/(default)/documents:commit?key=' + fb.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ writes: [{ transform: { document: name, fieldTransforms: [{ fieldPath: 'uses', increment: { integerValue: '1' } }] }, currentDocument: { exists: true } }] }),
    });
  }

  function orderMessage(data, c, v, ref) {
    var st = data.store;
    var cur = st.currency;
    var free = st.freeShippingOver && c.total >= st.freeShippingOver;
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
      'Subtotal: ' + money(c.subtotal, cur)
    );
    if (c.discount) out.push('Discount (' + c.couponCode + '): -' + money(c.discount, cur));
    out.push(
      '*Total: ' + money(c.total, cur) + '*',
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
    out.push('', 'Track this order: ' + (st.url || location.origin) + '/track/?ref=' + ref);
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

      // Keep a copy of the order for the admin panel, plus a tracking record
      // (never blocks WhatsApp — the WhatsApp message is the order of record).
      var fb = data.store.firebase;
      var order = {
        ref: ref,
        status: 'new',
        createdAt: new Date(),
        currency: data.store.currency,
        subtotal: c.subtotal,
        total: c.total,
        itemCount: c.count,
        items: c.lines.map(function (l) {
          return { slug: l.p.slug, name: l.p.name, sku: l.p.sku, qty: l.qty, price: l.p.price, total: l.total };
        }),
        customer: { name: v.name, phone: v.phone, address: v.address, city: v.city, payment: v.payment || '', notes: v.notes || '' },
      };
      if (c.discount) { order.discount = c.discount; order.couponCode = c.couponCode; }
      trackCheck(ref, v.phone)
        .then(function (check) { return saveOrder(fb, ref, order, check); })
        .then(function () { if (c.discount) return useCoupon(fb, c.couponCode); })
        .catch(function () { /* best effort */ });
      store(COUPON_KEY, null);

      if (!win) location.href = url; // pop-up blocked: open in this tab

      store(CART_KEY, {});
      updateCount();
      var root = document.querySelector('[data-cart]');
      root.innerHTML =
        '<div class="order-done">' + waIcon +
        '<h2>Your order is ready in WhatsApp</h2>' +
        '<p>Order reference <strong>' + esc(ref) + '</strong>. Press <strong>send</strong> in WhatsApp and our team will reply with delivery cost and payment details.</p>' +
        '<p><a class="btn btn-lg btn-wa" href="' + esc(url) + '" target="_blank" rel="noopener">' + waIcon + ' Open WhatsApp again</a> ' +
        '<a class="btn btn-lg btn-ghost" href="/track/?ref=' + encodeURIComponent(ref) + '">Track this order</a></p>' +
        '<p class="small">Save your order number <strong>' + esc(ref) + '</strong> to track it later.</p></div>';
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
      q.value = Math.min(Number(q.max) || 99, Math.max(1, (parseInt(q.value, 10) || 1) + Number(el.getAttribute('data-qty-step'))));
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
    if (t.closest('[data-coupon-remove]')) { store(COUPON_KEY, null); rerender(); return; }
    if ((el = t.closest('[data-gallery-src]'))) {
      var main = document.querySelector('[data-gallery-main]');
      main.src = el.getAttribute('data-gallery-src');
      document.querySelectorAll('[data-gallery-src]').forEach(function (b) {
        var on = b === el;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      return;
    }
    if (drawer && !drawer.hidden && t.closest('.drawer-panel a[href]')) closeDrawer();
  });

  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-cart-qty]');
    if (input) setQty(input.getAttribute('data-cart-qty'), Math.max(1, parseInt(input.value, 10) || 1));
  });

  document.addEventListener('submit', function (e) {
    var coupon = e.target.closest('[data-coupon-form]');
    if (coupon) { e.preventDefault(); applyCoupon(coupon); return; }
    var track = e.target.closest('[data-track-form]');
    if (track) { e.preventDefault(); lookupOrder(track); return; }
    var form = e.target.closest('[data-checkout]');
    if (!form) return;
    e.preventDefault();
    submitCheckout(form);
  });

  // ---------- order tracking page ----------
  var STEPS = [
    ['new', 'Order received', 'We have your order and will confirm it on WhatsApp.'],
    ['confirmed', 'Confirmed', 'Your order is confirmed and being prepared.'],
    ['shipped', 'On the way', 'Your order has been dispatched.'],
    ['delivered', 'Delivered', 'Your order has been delivered. Thank you!'],
  ];
  function tsValue(v) { return v && v.timestampValue ? new Date(v.timestampValue) : null; }

  function lookupOrder(form) {
    var out = document.querySelector('[data-track-result]');
    var err = form.querySelector('[data-track-error]');
    var ref = form.elements.ref.value.trim().toUpperCase().replace(/\s+/g, '');
    var last4 = form.elements.last4.value.replace(/\D/g, '');
    var say = function (m) { err.textContent = m; err.hidden = !m; };
    if (!/^UF-\d{6}-[A-Z0-9]{4,8}$/.test(ref)) return say('Enter your order number as shown, e.g. UF-261021-8K3QZP.');
    if (last4.length !== 4) return say('Enter the last 4 digits of your phone number.');
    say('');
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    out.innerHTML = '<p class="muted">Checking…</p>';
    catalog().then(function (data) {
      var fb = data.store.firebase;
      var url = 'https://firestore.googleapis.com/v1/projects/' + fb.projectId + '/databases/(default)/documents/tracking/' + encodeURIComponent(ref) + '?key=' + fb.apiKey;
      return Promise.all([fetch(url), sha256(ref + ':' + last4)]).then(function (r) {
        var res = r[0], check = r[1];
        if (res.status === 404 || res.status === 403) return null;
        if (!res.ok) throw new Error('We could not check your order right now. Please try again.');
        return res.json().then(function (doc) {
          var f = doc.fields || {};
          if (!f.check || f.check.stringValue !== check) return null; // wrong phone digits
          return {
            status: f.status ? f.status.stringValue : 'new',
            total: Number((f.total && (f.total.integerValue || f.total.doubleValue)) || 0),
            items: Number((f.itemCount && f.itemCount.integerValue) || 0),
            currency: f.currency ? f.currency.stringValue : 'NGN',
            created: tsValue(f.createdAt),
            updated: tsValue(f.updatedAt),
            history: ((f.history && f.history.arrayValue.values) || []).map(function (h) {
              var m = h.mapValue.fields;
              return { status: m.status.stringValue, at: tsValue(m.at) };
            }),
          };
        });
      }).then(function (o) {
        if (!o) {
          out.innerHTML = '<div class="track-card"><h2>Order not found</h2><p>Check the order number and the last 4 digits of the phone number you ordered with. Orders can take a minute to appear.</p>' +
            '<a class="btn btn-wa" href="https://wa.me/' + data.store.whatsapp + '?text=' + encodeURIComponent('Hello U-farm, I need help with my order ' + ref) + '" rel="noopener">' + waIcon + ' Ask us on WhatsApp</a></div>';
          return;
        }
        var fmt = function (d) { return d ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
        var when = {};
        o.history.forEach(function (h) { when[h.status] = h.at; });
        var cancelled = o.status === 'cancelled';
        var reached = STEPS.findIndex(function (s) { return s[0] === o.status; });
        out.innerHTML = '<div class="track-card">' +
          '<div class="track-head"><div><p class="eyebrow">Order ' + esc(ref) + '</p><h2>' + (cancelled ? 'Cancelled' : esc(STEPS[Math.max(0, reached)][1])) + '</h2></div>' +
          '<div class="track-sum"><b>' + money(o.total, o.currency) + '</b><span>' + o.items + ' item' + (o.items === 1 ? '' : 's') + ' · placed ' + esc(fmt(o.created)) + '</span></div></div>' +
          (cancelled
            ? '<p class="track-cancel">This order was cancelled. If this is unexpected, please contact us.</p>'
            : '<ol class="track-steps">' + STEPS.map(function (s, i) {
              var state = i < reached ? 'done' : i === reached ? 'now' : 'todo';
              return '<li class="' + state + '"><span class="track-dot" aria-hidden="true"></span><div><b>' + s[1] + '</b><p>' + s[2] + '</p>' +
                (when[s[0]] ? '<small>' + esc(fmt(when[s[0]])) + '</small>' : '') + '</div></li>';
            }).join('') + '</ol>') +
          '<a class="btn btn-wa" href="https://wa.me/' + data.store.whatsapp + '?text=' + encodeURIComponent('Hello U-farm, about my order ' + ref) + '" rel="noopener">' + waIcon + ' Questions? Chat with us</a></div>';
      });
    }).catch(function (e) { out.innerHTML = ''; say(e.message); })
      .finally(function () { btn.disabled = false; });
  }

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
  // Saves the message to Firestore; falls back to the visitor's email app.
  function setupContact(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(form);
      var v = {};
      ['name', 'email', 'phone', 'topic', 'message'].forEach(function (k) { v[k] = String(f.get(k) || '').trim().slice(0, k === 'message' ? 4000 : 200); });
      var note = form.querySelector('[data-form-note]');
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      catalog()
        .then(function (data) {
          var id = 'MSG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
          return saveDoc(data.store.firebase, 'messages', id, {
            name: v.name, email: v.email, phone: v.phone, topic: v.topic, message: v.message, status: 'new', createdAt: new Date(),
          });
        })
        .then(function () {
          form.reset();
          note.textContent = 'Thank you — your message has been received. We usually reply within one business day.';
          note.hidden = false;
        })
        .catch(function () {
          var mail = document.querySelector('.site-footer a[href^="mailto:"]');
          var to = mail ? mail.getAttribute('href') : 'mailto:';
          var body = 'Name: ' + v.name + '\nEmail: ' + v.email + '\nPhone: ' + (v.phone || '-') + '\n\n' + v.message;
          location.href = to + '?subject=' + encodeURIComponent('Website enquiry: ' + v.topic) + '&body=' + encodeURIComponent(body);
          note.textContent = 'We could not send that from the website, so your email app is opening with your message ready to send.';
          note.hidden = false;
        })
        .finally(function () { btn.disabled = false; });
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
  var trackForm = document.querySelector('[data-track-form]');
  if (trackForm) {
    var refParam = new URLSearchParams(location.search).get('ref');
    if (refParam) trackForm.elements.ref.value = refParam.toUpperCase();
  }
})();
