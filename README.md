# U-farm

Static, SEO-focused store for moisture meters, farm equipment and farm tools. No dependencies — just Node 18+.

```bash
npm start       # shop + admin at http://localhost:8080  (admin: /admin/)
npm run build   # generate dist/ only
npm run dev     # build + static preview (no admin)
```

## Admin panel (`/admin/`)

Add, edit and delete products, upload photos, and set price, "was" price, stock
(in stock / pre-order / out of stock) and home-page featuring. Every save
rebuilds and publishes the shop straight away.

- **Password:** set `ADMIN_PASSWORD`, or use the one in `admin.config.json`
  (created with a random password on first `npm start`). Keep that file private.
- **Data:** products are stored in `src/data/products.json`; uploaded photos in
  `public/assets/img/products/uploads/` (resized to max 1400px in the browser).
- A product's URL slug is fixed once created, so links never break.
- **Hosting:** the admin needs a Node host with a persistent disk (a VPS, Render,
  Railway, etc.). Run `npm start` behind HTTPS and set `PORT` and `ADMIN_PASSWORD`.
  On a static-only host (Netlify, Vercel, GitHub Pages) the shop works but the admin
  does not; use the admin locally, then deploy `dist/`.

## Where things live

| Edit this | To change |
|---|---|
| `src/site.js` | Domain, phone, email, WhatsApp, address, currency |
| `src/data/products.json` | Products, prices, specs (best edited in the admin panel) |
| `src/categories.js` | Category & sub-category landing pages, intros, FAQs |
| `src/posts.js` | Buying guides (`/guides/<slug>/`) |
| `src/templates.js` | Header, footer, page layout, product cards |
| `public/assets/` | CSS, JS, logo — copied into `dist/` as-is |

Deploy the `dist/` folder to any static host (Netlify, Cloudflare Pages, Vercel, GitHub Pages).

## How ordering works

1. "Add to cart" opens a slide-out cart drawer (quantity +/−, remove, free-shipping progress).
2. "Checkout on WhatsApp" goes to `/cart/`, where the customer enters name, phone, address, town and payment method.
3. "Send order on WhatsApp" opens a chat with `whatsapp` from `src/site.js`, with the full order filled in
   (order reference, items, quantities, prices, subtotal, delivery and customer details). The customer presses send.

The cart is stored in the visitor's browser (localStorage); nothing is charged online.
Payment choices on the form come from `paymentMethods` in `src/site.js`.

## Product photos

Aqua-Boy photos in `public/assets/img/products/aqua-boy/` are the manufacturer's (KPM) product images,
downloaded from distributor pages: KAM III from checkline.com, the others from store.ttech.vn.
Confirm you have permission to use them (ask KPM or your supplier when you become a stockist),
or replace them with your own photos. Aqua-Boy prices are estimates — confirm with your supplier.

## Before going live

1. Set the real `url`, phone, email, WhatsApp and address in `src/site.js`.
2. Add `public/assets/img/og-image.jpg` (1200×630) for social link previews.
3. Replace the illustrations with real product photos: put them in `public/assets/img/products/` and set `image` on each product.
4. Submit `https://<your-domain>/sitemap.xml` in Google Search Console.
