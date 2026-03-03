const express = require('express');
const router = express.Router();
const {
  getAllCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerStats
} = require('../controllers/customers');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// =====================
// PROTECTED ROUTES (Admin)
// =====================

// IMPORTANT: /stats/overview must come BEFORE /:id
// Otherwise Express matches 'stats' as an ID and this endpoint is never reached.

// Get stats
router.get('/stats/overview', protect, staffOnly, checkPermission('analytics', 'view'), getCustomerStats);

// Get all customers
router.get('/', protect, staffOnly, checkPermission('customers', 'view'), getAllCustomers);

// Get single customer
router.get('/:id', protect, staffOnly, checkPermission('customers', 'view'), getCustomer);

// Update customer
router.put('/:id', protect, staffOnly, checkPermission('customers', 'edit'), updateCustomer);

// Delete customer
router.delete('/:id', protect, staffOnly, checkPermission('customers', 'delete'), deleteCustomer);

module.exports = router;