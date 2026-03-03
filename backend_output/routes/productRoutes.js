const express = require('express');
const router = express.Router();

const {
  getProducts,
  getProduct,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
  getLowStockProducts,
  getOutOfStockProducts,
  getCategories,
  updateStock,
  checkAvailability,
  getFeaturedProducts
} = require('../controllers/productController');

// Use the functions that actually exist in auth.js
const { protect, extractClientId, checkPermission } = require('../middleware/auth');

/**
 * ===== 1. PUBLIC ROUTES (Storefront) =====
 * Specific paths MUST come before the generic /:id catch-all.
 */
router.get('/categories', extractClientId, getCategories);
router.get('/featured', extractClientId, getFeaturedProducts);
router.get('/slug/:slug', extractClientId, getProductBySlug);
router.post('/check-availability', extractClientId, checkAvailability);

/**
 * ===== 2. PROTECTED ADMIN ROUTES (Dashboard) =====
 * We place these BEFORE the public /:id so strings like 'reports' 
 * aren't mistakenly treated as product IDs.
 */
router.use(protect);

router.get(
  '/reports/low-stock',
  checkPermission('products', 'view'),
  getLowStockProducts
);

router.get(
  '/reports/out-of-stock',
  checkPermission('products', 'view'),
  getOutOfStockProducts
);

router.put(
  '/bulk/update',
  checkPermission('products', 'edit'),
  bulkUpdateProducts
);

router.post(
  '/',
  checkPermission('products', 'create'),
  createProduct
);

// Base collection fetch for admins
router.get('/', extractClientId, getProducts);

/**
 * ===== 3. DYNAMIC / ID-BASED ROUTES (Catch-Alls) =====
 * These are at the very bottom. If Express reaches this point, 
 * it knows the request isn't for 'featured' or 'reports'.
 */
router.get('/:id', extractClientId, getProduct);

router.put(
  '/:id',
  checkPermission('products', 'edit'),
  updateProduct
);

router.delete(
  '/:id',
  checkPermission('products', 'delete'),
  deleteProduct
);

router.put(
  '/:id/stock',
  checkPermission('products', 'edit'),
  updateStock
);

module.exports = router;