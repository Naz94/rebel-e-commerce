const express = require('express');
const router  = express.Router();

const {
  getDashboardOverview,
  getSalesOverTime,
  getTopProducts,
  getTopCustomers,
  getRevenueChart   // FIX: was implemented in controller but never wired to a route
} = require('../controllers/analytics');

const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// All analytics routes require staff auth + view permission
router.use(protect, staffOnly);

router.get('/dashboard',     checkPermission('analytics', 'view'), getDashboardOverview);
router.get('/sales',         checkPermission('analytics', 'view'), getSalesOverTime);
router.get('/top-products',  checkPermission('analytics', 'view'), getTopProducts);
router.get('/top-customers', checkPermission('analytics', 'view'), getTopCustomers);
router.get('/revenue-chart', checkPermission('analytics', 'view'), getRevenueChart);

module.exports = router;
