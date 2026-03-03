const express = require('express');
const router = express.Router();
const {
  createOrder,
  getAllOrders,
  getOrder,
  updateOrder,
  updateFulfillment,
  markAsPaid,
  cancelOrder,
  getCustomerOrders,
  getSalesStats
} = require('../controllers/orders');
const { protect, staffOnly, checkPermission, extractClientId } = require('../middleware/auth');

// =====================
// PUBLIC ROUTES
// =====================

/**
 * @route   POST /api/orders
 * @desc    Create order (checkout)
 * @access  Public
 */
router.post('/', extractClientId, createOrder);

// =====================
// PROTECTED ROUTES (Admin/Staff)
// =====================

// IMPORTANT: Static sub-routes (/stats/overview, /customer/:email) must come BEFORE /:id
// Otherwise Express matches 'stats' and 'customer' as IDs and these endpoints are unreachable.

/**
 * @route   GET /api/orders/stats/overview
 * @desc    Get sales analytics and revenue stats
 */
router.get('/stats/overview', protect, staffOnly, checkPermission('analytics', 'view'), getSalesStats);

/**
 * @route   GET /api/orders/customer/:email
 * @desc    Get order history for a specific customer email
 */
router.get('/customer/:email', protect, staffOnly, getCustomerOrders);

/**
 * @route   GET /api/orders
 * @desc    Get all orders for a client
 */
router.get('/', protect, staffOnly, checkPermission('orders', 'view'), getAllOrders);

/**
 * @route   GET /api/orders/:id
 * @desc    Get single order details
 */
router.get('/:id', protect, staffOnly, checkPermission('orders', 'view'), getOrder);

/**
 * @route   PUT /api/orders/:id
 * @desc    Update basic order details
 */
router.put('/:id', protect, staffOnly, checkPermission('orders', 'edit'), updateOrder);

/**
 * @route   PUT /api/orders/:id/fulfillment
 * @desc    Update shipping/fulfillment status
 */
router.put('/:id/fulfillment', protect, staffOnly, checkPermission('orders', 'edit'), updateFulfillment);

/**
 * @route   PUT /api/orders/:id/paid
 * @desc    Manually mark an order as paid (EFT/Bank Transfers)
 */
router.put('/:id/paid', protect, staffOnly, checkPermission('orders', 'edit'), markAsPaid);

/**
 * @route   PUT /api/orders/:id/cancel
 * @desc    Cancel an order
 */
router.put('/:id/cancel', protect, staffOnly, checkPermission('orders', 'edit'), cancelOrder);

module.exports = router;