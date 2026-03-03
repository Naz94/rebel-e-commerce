const mongoose = require('mongoose');
const Product = require('../models/Product');
const { uploadImage, deleteImage: cloudinaryDelete } = require('../utils/cloudinary');
const multer = require('multer');

const MAX_IMAGES_PER_PRODUCT = 20;
const UPLOAD_TIMEOUT_MS = 30000; // 30s timeout for cloud assets

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
}).array('images', 10);

/**
 * HELPER: Cloudinary Timeout Wrapper
 * Prevents hanging connections if the third-party provider is unresponsive.
 */
const uploadWithTimeout = (buffer, options) => {
  return Promise.race([
    uploadImage(buffer, options),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Cloudinary upload timed out')), UPLOAD_TIMEOUT_MS)
    )
  ]);
};

// =====================
// 1. UPLOAD PRODUCT IMAGES
// =====================
exports.uploadProductImages = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      const message = err instanceof multer.MulterError ? `Upload Error: ${err.message}` : 'Invalid file upload.';
      return res.status(400).json({ success: false, message });
    }

    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const uploadedPublicIds = [];

    try {
      if (!req.files?.length) return res.status(400).json({ success: false, message: 'No images provided' });

      // 1a. Upload with safety timeout
      const results = await Promise.all(req.files.map(file => 
        uploadWithTimeout(file.buffer, {
          folder: `stores/${req.clientId}/products/${productId}`,
          tags: [req.clientId, 'product_image', productId]
        })
      ));
      results.forEach(r => uploadedPublicIds.push(r.public_id));

      // 1b. Prepare images 
      // NOTE: Manual createdAt set because Aggregation Pipelines bypass Mongoose subdoc timestamps.
      const newImages = results.map(result => ({
        _id: new mongoose.Types.ObjectId(),
        url: result.secure_url,
        publicId: result.public_id,
        createdAt: new Date()
      }));

      // 1c. ATOMIC UPLOAD & ELECTION
      // NOTE: Pipeline updates bypass Mongoose Validators. Shape must be manually verified.
      const updatedProduct = await Product.findOneAndUpdate(
        { 
          _id: productId, 
          clientId: req.clientId,
          $expr: { $lte: [{ $add: [{ $size: '$images' }, newImages.length] }, MAX_IMAGES_PER_PRODUCT] }
        },
        [
          { $set: { images: { $concatArrays: ["$images", newImages] } } },
          { 
            $set: { 
              primaryImageId: { $ifNull: ["$primaryImageId", newImages[0]._id] },
              primaryImage: {
                $ifNull: [
                  "$primaryImage", 
                  { url: newImages[0].url, publicId: newImages[0].publicId }
                ]
              }
            } 
          }
        ],
        { new: true, lean: true }
      );

      if (!updatedProduct) {
        const exists = await Product.exists({ _id: productId, clientId: req.clientId });
        throw Object.assign(new Error(exists ? 'Maximum image capacity reached' : 'Product not found'), { isClientError: true });
      }

      res.status(200).json({ success: true, data: updatedProduct });

    } catch (error) {
      // Clean up Cloudinary orphans
      if (uploadedPublicIds.length > 0) {
        await Promise.all(uploadedPublicIds.map(id => 
          cloudinaryDelete(id).catch(err => 
            console.error(`[ROLLBACK_FAIL] Tenant: ${req.clientId} - ID: ${id}:`, err.message)
          )
        ));
      }
      console.error(`[UPLOAD_ERR] Tenant: ${req.clientId || 'UNKNOWN'}:`, error.stack);
      const status = error.isClientError ? 400 : 500;
      res.status(status).json({ success: false, message: error.message || 'Internal upload failure' });
    }
  });
};

// =====================
// 2. DELETE IMAGE
// =====================
exports.deleteProductImage = async (req, res) => {
  try {
    const { productId, imageId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    const objImageId = new mongoose.Types.ObjectId(imageId);

    // 2a. Pre-fetch publicId 
    // TOCTOU NOTE: If a concurrent request deletes this between here and the atomic update,
    // the atomic update will gracefully no-op. We accept the risk of one redundant Cloudinary API call.
    const productData = await Product.findOne(
      { _id: productId, clientId: req.clientId, "images._id": objImageId },
      { "images.$": 1 }
    ).lean();

    if (!productData) return res.status(404).json({ success: false, message: 'Image or Product not found' });
    const publicId = productData.images[0].publicId;

    // 2b. Atomic Delete & Re-election
    const updatedProduct = await Product.findOneAndUpdate(
      { _id: productId, clientId: req.clientId },
      [
        {
          $set: {
            images: {
              $filter: {
                input: "$images",
                cond: { $ne: ["$$this._id", objImageId] }
              }
            }
          }
        },
        {
          $set: {
            primaryImageId: {
              $cond: [
                { $eq: ["$primaryImageId", objImageId] },
                { $arrayElemAt: [{ $map: { input: "$images", as: "img", in: "$$img._id" } }, 0] },
                "$primaryImageId"
              ]
            },
            primaryImage: {
              $cond: [
                { $eq: ["$primaryImageId", objImageId] },
                { $arrayElemAt: ["$images", 0] }, 
                "$primaryImage"
              ]
            }
          }
        }
      ],
      { new: true, lean: true }
    );

    if (publicId) {
      cloudinaryDelete(publicId).catch(err => 
        console.error(`[CLEANUP_FAIL] Tenant: ${req.clientId} - ID: ${publicId}:`, err.message)
      );
    }

    res.json({ success: true, data: updatedProduct });
  } catch (error) {
    console.error(`[DELETE_IMAGE_ERR] Tenant: ${req.clientId || 'UNKNOWN'}:`, error.stack);
    res.status(500).json({ success: false, message: 'Failed to remove image' });
  }
};

// =====================
// 3. SET PRIMARY IMAGE
// =====================
exports.setPrimaryImage = async (req, res) => {
  try {
    const { productId, imageId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    const objImageId = new mongoose.Types.ObjectId(imageId);

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: productId, clientId: req.clientId, "images._id": objImageId },
      [
        {
          $set: {
            primaryImageId: objImageId,
            primaryImage: {
              $arrayElemAt: [
                { $filter: { input: "$images", cond: { $eq: ["$$this._id", objImageId] } } },
                0
              ]
            }
          }
        }
      ],
      { new: true, lean: true }
    );

    if (!updatedProduct) return res.status(404).json({ success: false, message: 'Image not found' });

    res.json({ success: true, data: updatedProduct });
  } catch (error) {
    console.error(`[SET_PRIMARY_ERR] Tenant: ${req.clientId || 'UNKNOWN'}:`, error.stack);
    res.status(500).json({ success: false, message: 'Failed to update primary image' });
  }
};