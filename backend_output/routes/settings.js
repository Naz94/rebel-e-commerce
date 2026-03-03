const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateBranding,
  updateStoreSettings,
  updateContact,
  getTierInfo
} = require('../controllers/settings');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// Get settings
router.get('/', protect, staffOnly, getSettings);

// Update branding
router.put('/branding', protect, staffOnly, checkPermission('settings', 'edit'), updateBranding);

// Update store settings
router.put('/store', protect, staffOnly, checkPermission('settings', 'edit'), updateStoreSettings);

// Update contact
router.put('/contact', protect, staffOnly, checkPermission('settings', 'edit'), updateContact);

// Get tier info
router.get('/tier/info', protect, staffOnly, getTierInfo);

module.exports = router;
