const express = require('express');
const router = express.Router();

const {
  getPublicSettings,
  updateBranding,
  createClient,
  updateClientTier,
  deleteClient
} = require('../controllers/clientController');
const { extractClientId, protect, staffOnly, checkPermission } = require('../middleware/auth');

// PUBLIC: Get store settings (storefront calls this on page load)
router.get('/settings', extractClientId, getPublicSettings);

// PROTECTED: Update branding only (logo, banner, colors - theme stays locked)
router.put(
  '/:id/branding',
  protect,
  checkPermission('settings', 'edit'),
  updateBranding
);

// PROTECTED: Super admin routes
router.post('/', protect, staffOnly, createClient);
router.put('/:id/plan', protect, staffOnly, updateClientTier);
router.delete('/:id', protect, staffOnly, deleteClient);

module.exports = router;