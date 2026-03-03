/**
 * ============================================================
 * HARVEST & CO — CLIENT CONFIG
 * ============================================================
 * Copy this file into the harvest-co/ folder as STORE_CONFIG.js
 * Fill in sections 1–10. That's your entire deployment job.
 * ============================================================
 */

window.STORE_CONFIG = {

  // 1. BACKEND
  apiBase:  'https://api.rebelengine.co.za/api/v1',
  clientId: 'PASTE_CLIENT_ID_HERE',

  // 2. STORE IDENTITY
  storeName:    "Pete's Butchery",
  storeTagline: "Premium cuts, sourced locally.",
  logoText:     "Pete's",
  logoImage:    '',        // e.g. 'https://cdn.petesbutchery.co.za/logo.png'
  favicon:      '',

  // 3. HERO
  heroHeadline:      "Freshness<br>you can <em>taste.</em>",
  heroSubtext:       "Premium grass-fed beef, free-range chicken & artisan charcuterie — delivered to your door across Joburg.",
  heroCTA:           "Shop Now",
  heroCTALink:       "products.html",
  heroSecondary:     "View Weekly Specials",
  heroSecondaryLink: "products.html?filter=specials",

  // 4. NAV LINKS
  navLinks: [
    { label: 'Home',    href: 'index.html' },
    { label: 'Shop',    href: 'products.html' },
    { label: 'About',   href: 'about.html' },
    { label: 'Contact', href: 'contact.html' },
  ],

  // 5. COLOURS  ← these are the Harvest defaults, change if the client has a brand colour
  colors: {
    primary:     '#1c1208',
    accent:      '#c8521a',
    accentAlt:   '#4a7c59',
    bg:          '#faf6f0',
    surface:     '#ffffff',
    text:        '#1c1208',
  },

  // 6. CURRENCY
  currency:     'R',
  currencyCode: 'ZAR',

  // 7. SECTIONS — set false to hide
  sections: {
    hero:             true,
    featuredProducts: true,
    categories:       true,
    specials:         true,
    testimonials:     false,   // ← flip to true once client has reviews
    newsletter:       true,
    whatsapp:         true,
  },

  // 8. PRODUCT CATEGORIES — match what client will use in their dashboard
  categories: [
    { label: 'Beef',     icon: '🥩', slug: 'beef' },
    { label: 'Chicken',  icon: '🍗', slug: 'chicken' },
    { label: 'Pork',     icon: '🥓', slug: 'pork' },
    { label: 'Lamb',     icon: '🍖', slug: 'lamb' },
    { label: 'Deli',     icon: '🧀', slug: 'deli' },
    { label: 'Specials', icon: '⭐', slug: 'specials' },
  ],

  // 9. FOOTER
  contact: {
    address:  '45 Main Street, Northcliff, Johannesburg, 2195',
    phone:    '011 123 4567',
    email:    'orders@petesbutchery.co.za',
    whatsapp: '+27821234567',
  },
  social: {
    facebook:  'https://facebook.com/petesbutchery',
    instagram: 'https://instagram.com/petesbutchery',
    tiktok:    '',
    twitter:   '',
  },
  hours: {
    weekdays: 'Mon – Fri: 07:00 – 18:00',
    saturday: 'Sat: 07:00 – 15:00',
    sunday:   'Sun: 08:00 – 13:00',
  },

  // 10. DELIVERY
  delivery: {
    freeOver: 500,
    flatRate: 80,
    areas:    'Johannesburg & surrounds',
    note:     'Orders before 12:00 dispatched same day.',
  },
};
