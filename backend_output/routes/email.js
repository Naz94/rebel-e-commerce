const express = require('express');
const router = express.Router();
const {
  sendOrderConfirmation,
  sendPaymentReceived,
  sendShippingConfirmation,
  sendTestEmail,
  resendOrderConfirmation
} = require('../controllers/email');

const { protect, checkPermission } = require('../middleware/auth');

// All routes require authentication
// (clientId is already set by the protect middleware from the JWT)
router.use(protect);

// Send test email
router.post('/test', sendTestEmail);

// Order emails
router.post(
  '/order-confirmation/:orderId',
  checkPermission('orders', 'view'),
  sendOrderConfirmation
);

router.post(
  '/payment-received/:orderId',
  checkPermission('orders', 'view'),
  sendPaymentReceived
);

router.post(
  '/shipped/:orderId',
  checkPermission('orders', 'edit'),
  sendShippingConfirmation
);

// Resend emails
router.post(
  '/resend/order-confirmation/:orderId',
  checkPermission('orders', 'view'),
  resendOrderConfirmation
);

module.exports = router;
