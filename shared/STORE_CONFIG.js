/**
 * ============================================================
 * REBEL ENGINE — CLIENT STORE CONFIG
 * ============================================================
 * This is the ONLY file you need to edit when deploying a
 * new client store. Everything else is automatic.
 *
 * DEPLOYMENT CHECKLIST:
 *   1. Fill in all fields below
 *   2. Copy the correct template folder (harvest-co / kinetic / techzone)
 *   3. Paste this file into that folder as STORE_CONFIG.js
 *   4. Upload to client's domain
 *   5. Done — no other files need touching
 * ============================================================
 */

window.STORE_CONFIG = {

  // ──────────────────────────────────────────
  // 1. BACKEND — YOUR SERVER URL + CLIENT ID
  // ──────────────────────────────────────────
  apiBase:  'https://api.rebelengine.co.za/api/v1',  // ← Your live API URL
  clientId: 'PASTE_CLIENT_ID_HERE',                   // ← Generated in your admin panel

  // ──────────────────────────────────────────
  // 2. STORE IDENTITY
  // ──────────────────────────────────────────
  storeName:    "Pete's Butchery",
  storeTagline: "Premium cuts, sourced locally.",
  logoText:     "Pete's",          // Short version used in nav logo
  logoImage:    '',                // URL to logo image. Leave empty to use text logo.
  favicon:      '',                // URL to favicon. Leave empty for default.

  // ──────────────────────────────────────────
  // 3. HERO SECTION (Homepage)
  // ──────────────────────────────────────────
  heroHeadline:    "Freshness you can taste.",
  heroSubtext:     "Premium grass-fed beef, free-range chicken & artisan charcuterie — delivered to your door across Joburg.",
  heroCTA:         "Shop Now",         // Primary button text
  heroCTALink:     "products.html",    // Where the button goes
  heroSecondary:   "View Weekly Specials",
  heroSecondaryLink: "products.html?filter=specials",

  // ──────────────────────────────────────────
  // 4. NAVIGATION LINKS
  // ──────────────────────────────────────────
  // Change labels, reorder, or remove items as needed.
  // href values are relative to the template folder.
  navLinks: [
    { label: 'Home',       href: 'index.html' },
    { label: 'Shop',       href: 'products.html' },
    { label: 'About',      href: 'about.html' },
    { label: 'Contact',    href: 'contact.html' },
  ],

  // ──────────────────────────────────────────
  // 5. COLOURS
  // ──────────────────────────────────────────
  // These map directly to CSS variables in the theme.
  // You only need to change what's different from the template defaults.
  colors: {
    primary:     '#1c1208',    // Main dark colour (nav, footer, headings)
    accent:      '#c8521a',    // Highlight colour (buttons, links, badges)
    accentAlt:   '#4a7c59',    // Secondary accent (optional)
    bg:          '#faf6f0',    // Page background
    surface:     '#ffffff',    // Card backgrounds
    text:        '#1c1208',    // Body text
  },

  // ──────────────────────────────────────────
  // 6. CURRENCY
  // ──────────────────────────────────────────
  currency:       'R',         // Displayed before prices. Default: R
  currencyCode:   'ZAR',       // ISO code. Default: ZAR

  // ──────────────────────────────────────────
  // 7. HOMEPAGE SECTIONS — SHOW / HIDE
  // ──────────────────────────────────────────
  // Set to false to completely hide a section from the homepage.
  sections: {
    hero:           true,
    featuredProducts: true,
    categories:     true,
    specials:       true,    // "Weekly Specials" banner
    testimonials:   false,   // Customer reviews section
    newsletter:     true,    // Email signup
    whatsapp:       true,    // Floating WhatsApp button
  },

  // ──────────────────────────────────────────
  // 8. PRODUCT CATEGORIES
  // ──────────────────────────────────────────
  // Shown as filter chips on the products page & category cards on homepage.
  // Match these exactly to the categories you use in the dashboard.
  categories: [
    { label: 'Beef',       icon: '🥩', slug: 'beef' },
    { label: 'Chicken',    icon: '🍗', slug: 'chicken' },
    { label: 'Pork',       icon: '🥓', slug: 'pork' },
    { label: 'Lamb',       icon: '🍖', slug: 'lamb' },
    { label: 'Deli',       icon: '🧀', slug: 'deli' },
    { label: 'Specials',   icon: '⭐', slug: 'specials' },
  ],

  // ──────────────────────────────────────────
  // 9. FOOTER INFO
  // ──────────────────────────────────────────
  contact: {
    address:   '45 Main Street, Northcliff, Johannesburg, 2195',
    phone:     '011 123 4567',
    email:     'orders@petesbutchery.co.za',
    whatsapp:  '+27821234567',   // Include country code, no spaces
  },

  social: {
    facebook:  'https://facebook.com/petesbutchery',
    instagram: 'https://instagram.com/petesbutchery',
    tiktok:    '',    // Leave empty to hide
    twitter:   '',
  },

  hours: {
    weekdays:  'Mon – Fri: 07:00 – 18:00',
    saturday:  'Sat: 07:00 – 15:00',
    sunday:    'Sun: 08:00 – 13:00',
  },

  // ──────────────────────────────────────────
  // 10. DELIVERY
  // ──────────────────────────────────────────
  delivery: {
    freeOver:   500,     // Free delivery on orders over this amount (0 = always free)
    flatRate:   80,      // Flat delivery fee when below freeOver
    areas:      'Johannesburg & surrounds',
    note:       'Orders before 12:00 dispatched same day.',
  },

};
