const express = require('express');
const router = express.Router();
const { handleWebhook, confirmManualPayment } = require('../controllers/checkout');
const { protect, staffOnly, extractClientId } = require('../middleware/auth');

// Webhook: raw body already captured in server.js for this path
router.post('/webhook/:provider', handleWebhook);

// Admin: manual EFT confirmation
router.post('/confirm-manual', protect, staffOnly, confirmManualPayment);

module.exports = router;
