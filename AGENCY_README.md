# Rebel Engine — Template Library
## Your Agency Deployment Guide

---

## How to deploy a new client store in 5 steps

### Step 1 — Create the client in your admin panel
Sign into your super-admin panel. Create a new tenant. Copy their generated `clientId`.

### Step 2 — Pick the right template

| Template folder | Best for |
|---|---|
| `harvest-co/` | Butchery, deli, food, FMCG, farm produce |
| `kinetic/` | Gym, supplements, sportswear, fitness |
| `techzone/` | Electronics, computers, gaming (already built) |

### Step 3 — Copy the template folder & fill in STORE_CONFIG.js

```bash
cp -r harvest-co/ petes-butchery/
cd petes-butchery/
# Open STORE_CONFIG.js in your editor
```

**STORE_CONFIG.js is the ONLY file you edit.** Fill in:

```js
clientId:    'abc123xyz',           // ← from admin panel
storeName:   "Pete's Butchery",
storeTagline: "Premium cuts, sourced locally.",
heroHeadline: "Freshness<br>you can <em>taste.</em>",
heroSubtext:  "Grass-fed beef...",

colors: {
  accent: '#c8521a',   // ← client's brand colour, change this
},

contact: {
  address:  '45 Main St, Northcliff',
  phone:    '011 123 4567',
  whatsapp: '+27821234567',
},

categories: [
  { label: 'Beef', icon: '🥩', slug: 'beef' },
  // ... match what the client will use in their dashboard
],
```

### Step 4 — Deploy to the client's domain

Upload all files to their web server or hosting (Netlify, cPanel, VPS — anything that serves static files).

```
petes-butchery/
  ├── STORE_CONFIG.js     ← the config you edited
  ├── index.html
  ├── products.html
  ├── product.html
  ├── cart.html
  ├── checkout.html
  ├── about.html
  ├── contact.html
  └── theme.css
```

Also make sure `../shared/rebel-engine.js` is accessible one level up, OR copy it into the same folder and update the script src paths.

### Step 5 — Give the client their dashboard login

Send them the `client-dashboard.html` URL and their credentials. They're self-sufficient from here.

---

## What the client can do themselves (no dev needed)

Via their dashboard login:
- ✅ Add, edit, delete products
- ✅ Upload product images
- ✅ Set prices and compare prices
- ✅ Manage stock levels
- ✅ View and process orders
- ✅ Approve or reject EFT payments
- ✅ Edit store info, banking details, trading hours
- ✅ View basic sales analytics

## What requires you (the agency)

- Adding a new section to a page (e.g. "About our farm")
- Changing the hero background image
- Adding a new template for a different industry
- Custom functionality (e.g. booking system, loyalty program)
- Domain/hosting changes

---

## Template customisation reference

### Change the accent colour only
```js
// STORE_CONFIG.js
colors: {
  accent: '#e63946',   // any hex
}
```

### Hide sections you don't need
```js
sections: {
  testimonials: false,   // ← hides completely
  specials:     false,
}
```

### Change nav links
```js
navLinks: [
  { label: 'Home',       href: 'index.html' },
  { label: 'Shop',       href: 'products.html' },
  { label: 'Our Story',  href: 'about.html' },     // ← rename freely
  { label: 'Contact',    href: 'contact.html' },
]
```

### Change categories (match dashboard exactly)
```js
categories: [
  { label: 'Beef',    icon: '🥩', slug: 'beef' },
  { label: 'Chicken', icon: '🍗', slug: 'chicken' },
]
// The slug MUST match the category name used in the client's products
```

---

## File structure overview

```
rebel-engine-templates/
│
├── shared/
│   └── rebel-engine.js         ← Core engine (never edit this)
│
├── harvest-co/                 ← Butchery / Food template
│   ├── STORE_CONFIG.js         ← EDIT THIS per client
│   ├── theme.css               ← Warm artisan aesthetic
│   ├── index.html
│   ├── products.html
│   ├── cart.html
│   ├── checkout.html
│   ├── about.html
│   └── contact.html
│
├── kinetic/                    ← Sport / Fitness template
│   ├── STORE_CONFIG.js         ← EDIT THIS per client
│   ├── theme.css               ← Dark electric aesthetic
│   └── (same pages as above)
│
└── client-dashboard.html       ← Client portal (one file for all clients)
```

---

## API endpoints used by the frontend

All calls go to `apiBase` set in STORE_CONFIG.js.

| Page | Endpoint |
|---|---|
| All pages | `GET /config/:clientId` |
| Homepage | `GET /products?featured=true&limit=8` |
| Products page | `GET /products?clientId=xxx&limit=500` |
| Product detail | `GET /products/:id` |
| Cart / Checkout | `POST /orders` |
| Order status | `GET /orders/status/:orderNumber` |

---

**Built with Rebel Engine 🇿🇦**
