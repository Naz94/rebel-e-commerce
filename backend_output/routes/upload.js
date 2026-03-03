const express = require('express');
const router = express.Router();
const {
  uploadProductImages,
  deleteImage,
  setPrimaryImage,
  reorderImages
} = require('../controllers/upload');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// Upload product images
router.post('/product/:productId', protect, staffOnly, checkPermission('products', 'edit'), uploadProductImages);

// Delete image
router.delete('/product/:productId/image/:imageId', protect, staffOnly, checkPermission('products', 'edit'), deleteImage);

// Set primary image
router.put('/product/:productId/image/:imageId/primary', protect, staffOnly, checkPermission('products', 'edit'), setPrimaryImage);

// Reorder images
router.put('/product/:productId/reorder', protect, staffOnly, checkPermission('products', 'edit'), reorderImages);

module.exports = router;