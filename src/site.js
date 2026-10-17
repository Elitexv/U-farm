// Global site settings. Change these before going live.
module.exports = {
  name: 'U-farm',
  legalName: 'U-farm Supplies',
  // Production URL, no trailing slash. Used for canonical links, sitemap and structured data.
  // Set SITE_URL (e.g. https://www.yourdomain.com) once you have a custom domain;
  // on Vercel it otherwise falls back to the project's production address.
  url: (
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    'https://u-farm.vercel.app'
  ).replace(/\/+$/, ''),
  tagline: 'Moisture Meters, Farm Equipment & Tools',
  description:
    'U-farm sells moisture meters for grain, hay, soil, wood, coffee and more, plus farm equipment and hand tools. Accurate, durable, farm-tested — shipped fast.',
  locale: 'en_US',
  lang: 'en',
  currency: 'NGN',
  currencySymbol: '₦',
  // Prices were converted from USD at about ₦1,550 = $1 — set your real prices in products.js.
  email: 'elite@ulishalimited.com', // contact & support
  phone: '+2347060438205', // used in tel: links and structured data
  phoneDisplay: '+234 706 043 8205', // shown on the page
  whatsapp: '2347060438205', // digits only, used for "order on WhatsApp"
  address: {
    street: '12 Harvest Road',
    city: 'Springfield',
    region: 'IL',
    postalCode: '62701',
    country: 'US',
  },
  hours: 'Mo-Sa 08:00-18:00',
  social: {
    facebook: 'https://www.facebook.com/ufarm',
    instagram: 'https://www.instagram.com/ufarm',
    youtube: 'https://www.youtube.com/@ufarm',
  },
  // Put a 1200x630 JPG here for link previews on social media.
  ogImage: '/assets/img/og-image.jpg',
  freeShippingOver: 250000,
  // Shown as choices on the checkout form and included in the WhatsApp order.
  paymentMethods: ['Bank transfer', 'Mobile money', 'Cash on delivery', 'Card (send me a payment link)'],
};
