const express = require('express');
const router  = express.Router();

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

const { protect, extractClientId, checkPermission } = require('../middleware/auth');

// =====================
// 1. PUBLIC ROUTES (Storefront — no auth required)
// IMPORTANT: specific paths BEFORE the /:id catch-all, and BEFORE router.use(protect)
// =====================

router.get('/categories',          extractClientId, getCategories);
router.get('/featured',            extractClientId, getFeaturedProducts);
router.get('/slug/:slug',          extractClientId, getProductBySlug);
router.post('/check-availability', extractClientId, checkAvailability);

// Public collection + single-product fetches (storefront browsing)
router.get('/',    extractClientId, getProducts);
router.get('/:id', extractClientId, getProduct);

// =====================
// 2. PROTECTED ADMIN ROUTES (Dashboard — require auth)
// router.use(protect) applies only to routes defined AFTER this line.
// The public routes above are already registered and unaffected.
// =====================

router.use(protect);

// Report endpoints — must be before /:id to avoid being swallowed as an ID
router.get('/reports/low-stock',      checkPermission('products', 'view'), getLowStockProducts);
router.get('/reports/out-of-stock',   checkPermission('products', 'view'), getOutOfStockProducts);

// Bulk write
router.put('/bulk/update', checkPermission('products', 'edit'), bulkUpdateProducts);

// Create
router.post('/', checkPermission('products', 'create'), createProduct);

// Per-product mutations
router.put('/:id',       checkPermission('products', 'edit'),   updateProduct);
router.delete('/:id',    checkPermission('products', 'delete'), deleteProduct);
router.put('/:id/stock', checkPermission('products', 'edit'),   updateStock);

module.exports = router;
