const express = require('express');
const router = express.Router();
const {
  getDashboardOverview,
  getSalesOverTime,
  getTopProducts,
  getTopCustomers
} = require('../controllers/analytics');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// Dashboard overview
router.get('/dashboard', protect, staffOnly, checkPermission('analytics', 'view'), getDashboardOverview);

// Sales over time
router.get('/sales', protect, staffOnly, checkPermission('analytics', 'view'), getSalesOverTime);

// Top products
router.get('/top-products', protect, staffOnly, checkPermission('analytics', 'view'), getTopProducts);

// Top customers
router.get('/top-customers', protect, staffOnly, checkPermission('analytics', 'view'), getTopCustomers);

module.exports = router;
