# U-farm

Static, SEO-focused store for moisture meters, farm equipment and farm tools. No dependencies — just Node 18+.

```bash
npm start       # build (reads Firestore) + preview at http://localhost:8080
npm run build   # generate dist/ only
```

## Data: Firebase

| Firestore collection | Holds | Who can read / write |
|---|---|---|
| `products` | The catalog (one document per product, ID = URL slug) | Anyone reads · admins write |
| `images` | Product photos uploaded in the admin (resized, stored as data) | Anyone reads · admins write |
| `settings/site` | WhatsApp, phone, email, address, free-delivery amount, payment methods | Anyone reads · admins write |
| `settings/private` | Vercel deploy hook URL | Admins only |
| `orders` | Every WhatsApp checkout | Customers create · admins read/update |
| `messages` | Contact-form messages | Visitors create · admins read/update |
| `admins` | One empty document per admin, ID = their Firebase UID | Set by hand in the console |

The build reads `products` and `settings/site` over the Firestore REST API (no packages),
writes uploaded photos out as normal image files, and pre-renders every page for SEO.
If Firestore is empty or unreachable, it falls back to `src/data/products.json`.
Google Analytics uses the Firebase measurement ID (skipped on localhost).

### One-time Firebase setup

1. **Firestore rules:** Firebase console → Firestore Database → Rules → paste `firestore.rules` → Publish.
2. **Sign-in:** Authentication → Get started → enable **Email/Password** → Users → Add user (your admin email + password).
3. **Make yourself admin:** open `/admin/`, log in — it shows your UID. In Firestore create a collection
   `admins` with a document whose ID is that UID (no fields needed). Reload `/admin/`.
4. **Import products:** in the admin click **Import starter catalog**.
5. **Publishing:** Vercel → Project → Settings → Git → Deploy Hooks → create one for `main`,
   paste the URL in admin **Settings**. The **Publish** button then rebuilds the live site (about a minute).

## Admin panel (`/admin/`)

Runs on the live site (and locally). Manage **products** (photos, prices, "was" price, stock,
home-page featuring), **orders**, **messages** and **settings**. Saves go to Firestore immediately;
click **Publish** to rebuild the public pages. A product's URL slug is fixed once created.

## Deploying on Vercel

`vercel.json` runs `node build.js` and serves `dist/` as a static site. When you add a custom
domain, set `SITE_URL` (e.g. `https://www.yourdomain.com`) in Vercel's environment variables.

## Where things live

| Edit this | To change |
|---|---|
| `src/site.js` | Domain, phone, email, WhatsApp, address, currency |
| Firestore `products` | Products, prices, specs, photos — edit in `/admin/` |
| `src/data/products.json` | Starter catalog / fallback if Firestore is empty or unreachable |
| `firestore.rules` | Who may read and write each kind of data |
| `src/categories.js` | Category & sub-category landing pages, intros, FAQs |
| `src/posts.js` | Buying guides (`/guides/<slug>/`) |
| `src/templates.js` | Header, footer, page layout, product cards |
| `public/assets/` | CSS, JS, logo — copied into `dist/` as-is |

Deploy the `dist/` folder to any static host (Netlify, Cloudflare Pages, Vercel, GitHub Pages).

## How ordering works

1. "Add to cart" opens a slide-out cart drawer (quantity +/−, remove, free-shipping progress).
2. "Checkout on WhatsApp" goes to `/cart/`, where the customer enters name, phone, address, town and payment method.
3. "Send order on WhatsApp" saves the order to Firestore (`orders`) and opens a chat with `whatsapp` from `src/site.js`, with the full order filled in
   (order reference, items, quantities, prices, subtotal, delivery and customer details). The customer presses send.

The cart is stored in the visitor's browser (localStorage); nothing is charged online.
Payment choices, WhatsApp number and other contact details come from **Settings** in the admin
(falling back to `src/site.js`). Contact-form messages are saved to Firestore (`messages`).

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
