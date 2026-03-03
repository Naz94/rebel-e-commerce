const express = require('express');
const router = express.Router();
const {
  // Paystack
  initializePaystackPayment,
  verifyPaystackPayment,
  handlePaystackWebhook,

  // Ozow
  initializeOzowPayment,
  handleOzowWebhook,

  // Yoco
  initializeYocoPayment,
  handleYocoWebhook,

  // SnapScan
  initializeSnapScanPayment,
  handleSnapScanWebhook,

  // Zapper
  initializeZapperPayment,
  handleZapperWebhook,

  // Manual EFT
  initializeEftPayment,

  // Admin
  markOrderAsPaid,
  processRefund,

  // Checkout UI
  getPaymentMethods
} = require('../controllers/payments');

const { protect, staffOnly, extractClientId } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: CHECKOUT UI
// ─────────────────────────────────────────────────────────────────────────────

router.get('/methods', extractClientId, getPaymentMethods);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: PAYMENT INITIALIZERS
// ─────────────────────────────────────────────────────────────────────────────

router.post('/paystack/initialize', extractClientId, initializePaystackPayment);
router.post('/ozow/initialize',     extractClientId, initializeOzowPayment);
router.post('/yoco/initialize',     extractClientId, initializeYocoPayment);
router.post('/snapscan/initialize', extractClientId, initializeSnapScanPayment);
router.post('/zapper/initialize',   extractClientId, initializeZapperPayment);
router.post('/eft/initialize',      extractClientId, initializeEftPayment);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: PAYMENT VERIFICATION (frontend redirect fallback)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/paystack/verify/:reference', extractClientId, verifyPaystackPayment);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: WEBHOOKS (called by gateway servers — verified internally)
// ─────────────────────────────────────────────────────────────────────────────

// Paystack: raw body already applied globally in server.js for this path
router.post('/paystack/webhook', handlePaystackWebhook);

router.post('/ozow/webhook',    handleOzowWebhook);
router.post('/yoco/webhook',    handleYocoWebhook);
router.post('/zapper/webhook',  handleZapperWebhook);

// SnapScan: form-encoded body with payload as JSON string — needs raw body for HMAC
router.post(
  '/snapscan/webhook',
  express.raw({ type: 'application/x-www-form-urlencoded' }),
  handleSnapScanWebhook
);

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED: ADMIN ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/:orderId/mark-paid', protect, staffOnly, markOrderAsPaid);
router.post('/refund',              protect, staffOnly, processRefund);

module.exports = router;