const express = require('express');
const router  = express.Router();

// FIX: import names now match the actual exports from controllers/upload.js
// - deleteProductImage  (was incorrectly imported as deleteImage)
// - reorderImages       (was imported but never existed — stubbed below)
const {
  uploadProductImages,
  deleteProductImage,
  setPrimaryImage,
  reorderImages        // exported from controller (stub added there)
} = require('../controllers/upload');

const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// Upload images for a product
router.post(
  '/product/:productId',
  protect, staffOnly, checkPermission('products', 'edit'),
  uploadProductImages
);

// Delete a specific image from a product
router.delete(
  '/product/:productId/image/:imageId',
  protect, staffOnly, checkPermission('products', 'edit'),
  deleteProductImage
);

// Promote an image to primary
router.put(
  '/product/:productId/image/:imageId/primary',
  protect, staffOnly, checkPermission('products', 'edit'),
  setPrimaryImage
);

// Reorder images array (sends back updated product)
router.put(
  '/product/:productId/reorder',
  protect, staffOnly, checkPermission('products', 'edit'),
  reorderImages
);

module.exports = router;
