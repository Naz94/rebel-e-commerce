/**
 * ============================================================
 * KINETIC — CLIENT CONFIG
 * ============================================================
 * Copy this file into the kinetic/ folder as STORE_CONFIG.js
 * Fill in sections 1–10. That's your entire deployment job.
 * ============================================================
 */

window.STORE_CONFIG = {

  // 1. BACKEND
  apiBase:  'https://api.rebelengine.co.za/api/v1',
  clientId: 'PASTE_CLIENT_ID_HERE',

  // 2. STORE IDENTITY
  storeName:    "Iron Republic",
  storeTagline: "No excuses. Just gains.",
  logoText:     "IRON REPUBLIC",
  logoImage:    '',
  favicon:      '',

  // 3. HERO
  heroHeadline:      "TRAIN<br><em>HARDER.</em>",
  heroSubtext:       "Premium supplements, gym gear and apparel — built for South African athletes who never skip leg day.",
  heroCTA:           "Shop Now",
  heroCTALink:       "products.html",
  heroSecondary:     "See This Week's Deals",
  heroSecondaryLink: "products.html?filter=specials",

  // 4. NAV LINKS
  navLinks: [
    { label: 'Home',        href: 'index.html' },
    { label: 'Shop',        href: 'products.html' },
    { label: 'About',       href: 'about.html' },
    { label: 'Contact',     href: 'contact.html' },
  ],

  // 5. COLOURS  ← Kinetic defaults: dark + electric lime. Change accent for client brand.
  colors: {
    primary:     '#0a0a0a',
    accent:      '#c8ff00',     // ← The main brand colour. e.g. '#ff6b00' for orange
    accentAlt:   '#ff3d3d',
    bg:          '#0f0f0f',
    surface:     '#1a1a1a',
    text:        '#f0f0f0',
  },

  // 6. CURRENCY
  currency:     'R',
  currencyCode: 'ZAR',

  // 7. SECTIONS
  sections: {
    hero:             true,
    featuredProducts: true,
    categories:       true,
    specials:         true,
    testimonials:     false,
    newsletter:       true,
    whatsapp:         true,
  },

  // 8. PRODUCT CATEGORIES
  categories: [
    { label: 'Protein',       icon: '💪', slug: 'protein' },
    { label: 'Pre-Workout',   icon: '⚡', slug: 'pre-workout' },
    { label: 'Vitamins',      icon: '💊', slug: 'vitamins' },
    { label: 'Gym Gear',      icon: '🏋️', slug: 'gym-gear' },
    { label: 'Apparel',       icon: '👕', slug: 'apparel' },
    { label: 'Deals',         icon: '🔥', slug: 'specials' },
  ],

  // 9. FOOTER
  contact: {
    address:  '12 Fitness Ave, Sandton, Johannesburg, 2196',
    phone:    '010 123 4567',
    email:    'orders@ironrepublic.co.za',
    whatsapp: '+27831234567',
  },
  social: {
    facebook:  'https://facebook.com/ironrepublic',
    instagram: 'https://instagram.com/ironrepublic',
    tiktok:    'https://tiktok.com/@ironrepublic',
    twitter:   '',
  },
  hours: {
    weekdays: 'Mon – Fri: 08:00 – 18:00',
    saturday: 'Sat: 09:00 – 14:00',
    sunday:   'Online orders only',
  },

  // 10. DELIVERY
  delivery: {
    freeOver: 750,
    flatRate: 99,
    areas:    'Nationwide',
    note:     'Orders before 14:00 dispatched same day.',
  },
};
