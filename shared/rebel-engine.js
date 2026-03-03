/**
 * ============================================================
 * REBEL ENGINE v3.0 — Multi-Tenant SA E-Commerce Core
 * ============================================================
 * One file to rule all templates.
 * Drop this into any theme. Configure once. Everything works.
 * ============================================================
 */

(function (window) {
  'use strict';

  // ─────────────────────────────────────────────
  // 1. GLOBAL CONFIG
  // ─────────────────────────────────────────────
  const RebelEngine = {
    version: '3.0',
    _config: null,
    _clientId: null,
    _apiBase: null,

    /**
     * Bootstrap the engine. Call this on every page.
     * @param {object} options
     * @param {string} options.clientId       - The tenant client ID
     * @param {string} options.apiBase        - Backend API base URL (no trailing slash)
     * @param {string} [options.theme]        - Optional theme override
     */
    async init(options = {}) {
      this._clientId = options.clientId
        || localStorage.getItem('re_clientId')
        || null;

      this._apiBase = options.apiBase
        || localStorage.getItem('re_apiBase')
        || 'https://api.rebelengine.co.za/api/v1';

      if (!this._clientId) {
        console.warn('[RebelEngine] ⚠️  No clientId set. Call RebelEngine.init({ clientId: "xxx" })');
        return;
      }

      // Persist for page navigations
      localStorage.setItem('re_clientId', this._clientId);
      localStorage.setItem('re_apiBase', this._apiBase);

      // Load remote config (branding, store name, theme overrides)
      await this._loadConfig();

      // Apply branding to DOM
      this._applyBranding();

      // Sync cart badge
      Cart.updateBadge();

      // Init nav behaviours
      Nav.init();

      console.log(`[RebelEngine] ✅ ${this._config?.storeName || 'Store'} ready.`);
      return this._config;
    },

    async _loadConfig() {
      try {
        const res = await fetch(`${this._apiBase}/config/${this._clientId}`);
        const json = await res.json();
        if (json.success) {
          this._config = json.data;
        }
      } catch (e) {
        console.warn('[RebelEngine] Could not load remote config — using defaults.');
        this._config = {};
      }
    },

    _applyBranding() {
      const c = this._config || {};
      const root = document.documentElement;

      // CSS variable injection — themes define their defaults, config can override
      if (c.primaryColor)  root.style.setProperty('--re-primary',   c.primaryColor);
      if (c.accentColor)   root.style.setProperty('--re-accent',    c.accentColor);
      if (c.bgColor)       root.style.setProperty('--re-bg',        c.bgColor);
      if (c.textColor)     root.style.setProperty('--re-text',      c.textColor);

      // Store name injection
      const name = c.storeName || '';
      document.querySelectorAll('[data-store-name]').forEach(el => el.textContent = name);
      document.querySelectorAll('[data-store-tagline]').forEach(el => el.textContent = c.tagline || '');
      document.querySelectorAll('[data-store-phone]').forEach(el => el.textContent = c.phone || '');
      document.querySelectorAll('[data-store-email]').forEach(el => el.textContent = c.email || '');
      document.querySelectorAll('[data-store-address]').forEach(el => el.textContent = c.address || '');

      // Logo image
      if (c.logoUrl) {
        document.querySelectorAll('[data-store-logo]').forEach(el => {
          el.src = c.logoUrl;
          el.style.display = 'block';
        });
        document.querySelectorAll('[data-store-logo-text]').forEach(el => {
          el.style.display = 'none';
        });
      }

      // Page title
      if (c.storeName) {
        const current = document.title;
        document.title = current.includes('|')
          ? current.replace(/^[^|]+\|/, `${c.storeName} |`)
          : `${c.storeName}`;
      }

      // WhatsApp link
      if (c.whatsapp) {
        document.querySelectorAll('[data-whatsapp]').forEach(el => {
          el.href = `https://wa.me/${c.whatsapp.replace(/\D/g, '')}`;
        });
      }
    },

    get config() { return this._config; },
    get clientId() { return this._clientId; },
    get apiBase() { return this._apiBase; },
  };


  // ─────────────────────────────────────────────
  // 2. CURRENCY — South African Rand
  // ─────────────────────────────────────────────
  const Currency = {
    format(amount) {
      const num = parseFloat(amount) || 0;
      return `R ${num.toLocaleString('en-ZA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    },
    raw(amount) {
      return parseFloat(amount) || 0;
    }
  };


  // ─────────────────────────────────────────────
  // 3. PRODUCTS API
  // ─────────────────────────────────────────────
  const Products = {
    _cache: null,

    async getAll(params = {}) {
      try {
        const qs = new URLSearchParams(params).toString();
        const url = `${RebelEngine._apiBase}/products${qs ? '?' + qs : ''}`;
        const res = await fetch(url, {
          headers: { 'X-Client-ID': RebelEngine._clientId }
        });
        const json = await res.json();
        if (json.success) {
          this._cache = json.data;
          return json.data;
        }
        return [];
      } catch (e) {
        console.error('[Products] Fetch error:', e);
        return [];
      }
    },

    async getOne(productId) {
      try {
        const res = await fetch(`${RebelEngine._apiBase}/products/${productId}`, {
          headers: { 'X-Client-ID': RebelEngine._clientId }
        });
        const json = await res.json();
        return json.success ? json.data : null;
      } catch (e) {
        console.error('[Products] Single fetch error:', e);
        return null;
      }
    },

    async getByCategory(category) {
      return this.getAll({ category });
    },

    async getFeatured(limit = 8) {
      return this.getAll({ featured: true, limit });
    },

    /**
     * Render products into a container element.
     * @param {string|HTMLElement} container - selector or element
     * @param {Array} products
     * @param {function} [cardTemplate] - optional custom card renderer
     */
    render(container, products, cardTemplate) {
      const el = typeof container === 'string'
        ? document.querySelector(container)
        : container;
      if (!el) return;

      if (!products || products.length === 0) {
        el.innerHTML = `<div class="re-empty">No products found.</div>`;
        return;
      }

      const tpl = cardTemplate || Products._defaultCard;
      el.innerHTML = products.map(p => tpl(p)).join('');
    },

    _defaultCard(product) {
      const img = product.images?.[0]?.url || product.images?.[0]
        || `https://placehold.co/400x400/1a1a1a/ffffff?text=${encodeURIComponent(product.name)}`;
      const price = Currency.format(product.price);
      const oldPrice = product.comparePrice
        ? `<span class="re-card__old-price">${Currency.format(product.comparePrice)}</span>` : '';
      const badge = product.badge
        ? `<span class="re-card__badge">${product.badge}</span>` : '';
      const stock = product.inStock === false
        ? `<span class="re-card__stock re-card__stock--out">Out of Stock</span>`
        : `<span class="re-card__stock re-card__stock--in">In Stock</span>`;

      return `
        <article class="re-card" data-product-id="${product._id}" onclick="window.location='product.html?id=${product._id}'">
          <div class="re-card__media">
            <img src="${img}" alt="${product.name}" loading="lazy">
            ${badge}
            <button class="re-card__wishlist ${Wishlist.has(product._id) ? 'active' : ''}"
              onclick="event.stopPropagation(); Wishlist.toggle('${product._id}', this)"
              aria-label="Add to wishlist">♡</button>
          </div>
          <div class="re-card__body">
            ${product.category ? `<p class="re-card__category">${product.category}</p>` : ''}
            <h3 class="re-card__name">${product.name}</h3>
            <div class="re-card__pricing">
              <span class="re-card__price">${price}</span>
              ${oldPrice}
            </div>
            ${stock}
            <button class="re-card__cta re-btn re-btn--primary"
              onclick="event.stopPropagation(); Cart.add('${product._id}', '${product.name.replace(/'/g, "\\'")}', ${product.price}, '${img}')">
              Add to Cart
            </button>
          </div>
        </article>
      `;
    }
  };


  // ─────────────────────────────────────────────
  // 4. CART
  // ─────────────────────────────────────────────
  const Cart = {
    KEY: 're_cart',

    get() {
      try {
        return JSON.parse(localStorage.getItem(this.KEY)) || [];
      } catch { return []; }
    },

    save(cart) {
      localStorage.setItem(this.KEY, JSON.stringify(cart));
      this.updateBadge();
      this._dispatchChange(cart);
    },

    add(productId, name, price, image = '') {
      const cart = this.get();
      const existing = cart.find(i => i.id === productId);
      if (existing) {
        existing.qty += 1;
      } else {
        cart.push({ id: productId, name, price: parseFloat(price), image, qty: 1 });
      }
      this.save(cart);
      this._toast(`${name} added to cart`);
    },

    remove(productId) {
      const cart = this.get().filter(i => i.id !== productId);
      this.save(cart);
    },

    setQty(productId, qty) {
      const cart = this.get();
      const item = cart.find(i => i.id === productId);
      if (item) {
        item.qty = Math.max(1, parseInt(qty));
        this.save(cart);
      }
    },

    clear() {
      localStorage.removeItem(this.KEY);
      this.updateBadge();
    },

    count() {
      return this.get().reduce((sum, i) => sum + i.qty, 0);
    },

    subtotal() {
      return this.get().reduce((sum, i) => sum + (i.price * i.qty), 0);
    },

    updateBadge() {
      const count = this.count();
      document.querySelectorAll('[data-cart-count]').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
      });
    },

    _toast(msg) {
      const existing = document.querySelector('.re-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 're-toast';
      toast.textContent = msg;
      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.add('re-toast--show');
        setTimeout(() => {
          toast.classList.remove('re-toast--show');
          setTimeout(() => toast.remove(), 300);
        }, 2500);
      });
    },

    _dispatchChange(cart) {
      window.dispatchEvent(new CustomEvent('re:cartchange', { detail: { cart } }));
    },

    /**
     * Render cart items into a container
     */
    renderItems(container) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) return;

      const cart = this.get();
      if (cart.length === 0) {
        el.innerHTML = `<div class="re-empty"><p>Your cart is empty.</p><a href="shop.html" class="re-btn re-btn--primary">Continue Shopping</a></div>`;
        return;
      }

      el.innerHTML = cart.map(item => `
        <div class="re-cart-item" data-id="${item.id}">
          <img src="${item.image || 'https://placehold.co/80x80'}" alt="${item.name}" class="re-cart-item__img">
          <div class="re-cart-item__info">
            <p class="re-cart-item__name">${item.name}</p>
            <p class="re-cart-item__price">${Currency.format(item.price)}</p>
          </div>
          <div class="re-cart-item__qty">
            <button onclick="Cart.setQty('${item.id}', ${item.qty - 1}); Cart.renderItems('[data-cart-items]'); Cart.renderSummary('[data-cart-summary]')" ${item.qty <= 1 ? 'disabled' : ''}>−</button>
            <span>${item.qty}</span>
            <button onclick="Cart.setQty('${item.id}', ${item.qty + 1}); Cart.renderItems('[data-cart-items]'); Cart.renderSummary('[data-cart-summary]')">+</button>
          </div>
          <p class="re-cart-item__total">${Currency.format(item.price * item.qty)}</p>
          <button class="re-cart-item__remove" onclick="Cart.remove('${item.id}'); Cart.renderItems('[data-cart-items]'); Cart.renderSummary('[data-cart-summary]')">×</button>
        </div>
      `).join('');
    },

    renderSummary(container, shippingCost = 0) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) return;

      const sub = this.subtotal();
      const shipping = this.count() === 0 ? 0 : shippingCost;
      const total = sub + shipping;

      el.innerHTML = `
        <div class="re-summary">
          <div class="re-summary__row"><span>Subtotal</span><span>${Currency.format(sub)}</span></div>
          <div class="re-summary__row"><span>Shipping</span><span>${shipping === 0 ? 'Calculated at checkout' : Currency.format(shipping)}</span></div>
          <div class="re-summary__row re-summary__row--total"><span>Total</span><span>${Currency.format(total)}</span></div>
          <a href="checkout.html" class="re-btn re-btn--primary re-btn--full">Proceed to Checkout</a>
          <a href="shop.html" class="re-btn re-btn--ghost re-btn--full">Continue Shopping</a>
        </div>
      `;
    }
  };


  // ─────────────────────────────────────────────
  // 5. WISHLIST
  // ─────────────────────────────────────────────
  const Wishlist = {
    KEY: 're_wishlist',

    get() {
      try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; }
    },

    has(id) { return this.get().includes(id); },

    toggle(id, btnEl) {
      let list = this.get();
      if (list.includes(id)) {
        list = list.filter(i => i !== id);
        if (btnEl) btnEl.classList.remove('active');
      } else {
        list.push(id);
        if (btnEl) { btnEl.classList.add('active'); btnEl.textContent = '♥'; }
      }
      localStorage.setItem(this.KEY, JSON.stringify(list));
      this.updateBadge();
    },

    updateBadge() {
      const count = this.get().length;
      document.querySelectorAll('[data-wishlist-count]').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
      });
    }
  };


  // ─────────────────────────────────────────────
  // 6. ORDERS & CHECKOUT
  // ─────────────────────────────────────────────
  const Orders = {
    async submit(formData) {
      const cart = Cart.get();
      if (cart.length === 0) throw new Error('Cart is empty');

      const payload = {
        ...formData,
        items: cart.map(i => ({
          productId: i.id,
          name: i.name,
          price: i.price,
          quantity: i.qty
        })),
        subtotal: Cart.subtotal(),
        currency: 'ZAR'
      };

      const res = await fetch(`${RebelEngine._apiBase}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-ID': RebelEngine._clientId
        },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Order failed');

      // Clear cart on success
      Cart.clear();
      return json.data; // returns { orderId, orderNumber, eftDetails? }
    },

    /**
     * Render EFT banking details after order placed
     */
    renderEFTDetails(container, orderData) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el || !orderData.eftDetails) return;

      const { bankName, accountHolder, accountNumber, branchCode, reference } = orderData.eftDetails;
      el.innerHTML = `
        <div class="re-eft">
          <h3>🏦 EFT Payment Details</h3>
          <p class="re-eft__note">Please use your order number as the payment reference.</p>
          <div class="re-eft__detail"><span>Bank</span><strong>${bankName}</strong></div>
          <div class="re-eft__detail"><span>Account Holder</span><strong>${accountHolder}</strong></div>
          <div class="re-eft__detail"><span>Account Number</span><strong>${accountNumber}</strong></div>
          <div class="re-eft__detail"><span>Branch Code</span><strong>${branchCode}</strong></div>
          <div class="re-eft__detail re-eft__reference"><span>Reference</span><strong>${reference || orderData.orderNumber}</strong></div>
          <p class="re-eft__warning">⚠️ Your order will only be processed once payment is confirmed.</p>
        </div>
      `;
    },

    /**
     * Get order status by order number
     */
    async getStatus(orderNumber) {
      const res = await fetch(`${RebelEngine._apiBase}/orders/status/${orderNumber}`, {
        headers: { 'X-Client-ID': RebelEngine._clientId }
      });
      const json = await res.json();
      return json.success ? json.data : null;
    }
  };


  // ─────────────────────────────────────────────
  // 7. NAVIGATION
  // ─────────────────────────────────────────────
  const Nav = {
    init() {
      // Mobile hamburger
      const hamburger = document.querySelector('[data-hamburger]');
      const mobileNav = document.querySelector('[data-mobile-nav]');
      if (hamburger && mobileNav) {
        hamburger.addEventListener('click', () => {
          mobileNav.classList.toggle('open');
          hamburger.classList.toggle('active');
        });
        // Close on outside click
        document.addEventListener('click', e => {
          if (!hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
            mobileNav.classList.remove('open');
            hamburger.classList.remove('active');
          }
        });
      }

      // Active nav link
      const path = window.location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('[data-nav-link]').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.includes(path)) link.classList.add('active');
      });

      // Sticky nav on scroll
      const nav = document.querySelector('[data-nav]');
      if (nav) {
        window.addEventListener('scroll', () => {
          nav.classList.toggle('scrolled', window.scrollY > 50);
        }, { passive: true });
      }

      // Cart icon click → cart page
      document.querySelectorAll('[data-cart-icon]').forEach(el => {
        el.addEventListener('click', () => { window.location.href = 'cart.html'; });
      });
    }
  };


  // ─────────────────────────────────────────────
  // 8. SEARCH
  // ─────────────────────────────────────────────
  const Search = {
    async query(term) {
      if (!term || term.length < 2) return [];
      const all = await Products.getAll({ search: term });
      return all;
    },

    initLive(inputSelector, resultsSelector) {
      const input = document.querySelector(inputSelector);
      const results = document.querySelector(resultsSelector);
      if (!input || !results) return;

      let timer;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const val = input.value.trim();
        if (val.length < 2) { results.innerHTML = ''; results.classList.remove('open'); return; }
        timer = setTimeout(async () => {
          const products = await Search.query(val);
          if (products.length === 0) {
            results.innerHTML = `<div class="re-search__empty">No results for "${val}"</div>`;
          } else {
            results.innerHTML = products.slice(0, 5).map(p => `
              <a href="product.html?id=${p._id}" class="re-search__result">
                <img src="${p.images?.[0]?.url || p.images?.[0] || ''}" alt="${p.name}">
                <div>
                  <strong>${p.name}</strong>
                  <span>${Currency.format(p.price)}</span>
                </div>
              </a>
            `).join('');
          }
          results.classList.add('open');
        }, 300);
      });

      // Close on outside click
      document.addEventListener('click', e => {
        if (!input.contains(e.target) && !results.contains(e.target)) {
          results.classList.remove('open');
        }
      });
    }
  };


  // ─────────────────────────────────────────────
  // 9. HELPERS
  // ─────────────────────────────────────────────
  const Helpers = {
    /** Get URL param */
    param(name) {
      return new URLSearchParams(window.location.search).get(name);
    },

    /** Debounce */
    debounce(fn, ms = 300) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    },

    /** Format date for SA locale */
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    },

    /** Render star rating */
    stars(rating, max = 5) {
      const full = Math.floor(rating);
      const half = rating % 1 >= 0.5 ? 1 : 0;
      const empty = max - full - half;
      return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
    },

    /** Show/hide loading spinner in container */
    loading(container, show = true) {
      const el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) return;
      if (show) {
        el.innerHTML = `<div class="re-loading"><div class="re-spinner"></div><p>Loading...</p></div>`;
      }
    }
  };


  // ─────────────────────────────────────────────
  // EXPOSE TO WINDOW
  // ─────────────────────────────────────────────
  window.RebelEngine = RebelEngine;
  window.Currency    = Currency;
  window.Products    = Products;
  window.Cart        = Cart;
  window.Wishlist    = Wishlist;
  window.Orders      = Orders;
  window.Nav         = Nav;
  window.Search      = Search;
  window.Helpers     = Helpers;

  // Auto-init cart badge on load
  document.addEventListener('DOMContentLoaded', () => {
    Cart.updateBadge();
    Wishlist.updateBadge();
  });

})(window);
