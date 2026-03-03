const cloudinary = require('cloudinary').v2;
const { ErrorResponse } = require('../middleware/error');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image to Cloudinary
 * @param {Buffer} fileBuffer - Image buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Cloudinary response
 */
exports.uploadImage = async (fileBuffer, options = {}) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || 'ecommerce',
          public_id: options.public_id,
          transformation: options.transformation || [
            { width: 2000, height: 2000, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ],
          resource_type: 'image'
        },
        (error, result) => {
          if (error) {
            reject(new ErrorResponse('Image upload failed', 500));
          } else {
            // Standardized to match controller expectations (secure_url and public_id)
            resolve({
              secure_url: result.secure_url,
              public_id: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format,
              size: result.bytes
            });
          }
        }
      );

      uploadStream.end(fileBuffer);
    });
  } catch (err) {
    throw new ErrorResponse('Image upload failed', 500);
  }
};

/**
 * Upload multiple images
 * @param {Array} files - Array of file buffers
 * @param {Object} options - Upload options
 * @returns {Promise<Array>} - Array of upload results
 */
exports.uploadMultipleImages = async (files, options = {}) => {
  try {
    const uploadPromises = files.map(file => 
      exports.uploadImage(file.buffer, {
        ...options,
        folder: `${options.folder}/${Date.now()}`
      })
    );

    return await Promise.all(uploadPromises);
  } catch (err) {
    throw new ErrorResponse('Multiple image upload failed', 500);
  }
};

/**
 * Delete image from Cloudinary
 * @param {String} cloudinaryId - Cloudinary public_id
 * @returns {Promise<Object>} - Cloudinary response
 */
exports.deleteImage = async (cloudinaryId) => {
  try {
    const result = await cloudinary.uploader.destroy(cloudinaryId);
    
    if (result.result === 'ok') {
      return { success: true, message: 'Image deleted successfully' };
    } else {
      throw new ErrorResponse('Image deletion failed', 500);
    }
  } catch (err) {
    throw new ErrorResponse('Image deletion failed', 500);
  }
};

/**
 * Upload logo (optimized for logos)
 * @param {Buffer} fileBuffer - Logo file buffer
 * @param {String} clientId - Client ID
 * @returns {Promise<Object>} - Upload result
 */
exports.uploadLogo = async (fileBuffer, clientId) => {
  return await exports.uploadImage(fileBuffer, {
    folder: `clients/${clientId}/branding`,
    public_id: `logo-${Date.now()}`,
    transformation: [
      { width: 500, height: 500, crop: 'limit' },
      { quality: 'auto:best' },
      { fetch_format: 'auto' },
      { background: 'transparent' }
    ]
  });
};

/**
 * Upload favicon
 * @param {Buffer} fileBuffer - Favicon file buffer
 * @param {String} clientId - Client ID
 * @returns {Promise<Object>} - Upload result
 */
exports.uploadFavicon = async (fileBuffer, clientId) => {
  return await exports.uploadImage(fileBuffer, {
    folder: `clients/${clientId}/branding`,
    public_id: `favicon-${Date.now()}`,
    transformation: [
      { width: 512, height: 512, crop: 'fill' },
      { quality: 'auto:best' },
      { fetch_format: 'png' }
    ]
  });
};

/**
 * Upload product image (optimized for e-commerce)
 * @param {Buffer} fileBuffer - Product image buffer
 * @param {String} clientId - Client ID
 * @param {String} productSku - Product SKU
 * @returns {Promise<Object>} - Upload result
 */
exports.uploadProductImage = async (fileBuffer, clientId, productSku) => {
  return await exports.uploadImage(fileBuffer, {
    folder: `clients/${clientId}/products`,
    public_id: `${productSku}-${Date.now()}`,
    transformation: [
      { width: 1500, height: 1500, crop: 'limit' },
      { quality: 'auto:good' },
      { fetch_format: 'auto' }
    ]
  });
};

/**
 * Generate image thumbnail
 * @param {String} imageUrl - Original image URL
 * @param {Number} width - Thumbnail width
 * @param {Number} height - Thumbnail height
 * @returns {String} - Thumbnail URL
 */
exports.generateThumbnail = (imageUrl, width = 200, height = 200) => {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
    return imageUrl;
  }

  // Insert transformation into Cloudinary URL
  const parts = imageUrl.split('/upload/');
  if (parts.length === 2) {
    return `${parts[0]}/upload/w_${width},h_${height},c_fill,q_auto,f_auto/${parts[1]}`;
  }

  return imageUrl;
};

/**
 * Optimize existing image URL
 * @param {String} imageUrl - Original image URL
 * @param {Object} options - Optimization options
 * @returns {String} - Optimized URL
 */
exports.optimizeImageUrl = (imageUrl, options = {}) => {
  if (!imageUrl || !imageUrl.includes('cloudinary.com')) {
    return imageUrl;
  }

  const {
    width = 1000,
    quality = 'auto',
    format = 'auto'
  } = options;

  const parts = imageUrl.split('/upload/');
  if (parts.length === 2) {
    return `${parts[0]}/upload/w_${width},q_${quality},f_${format}/${parts[1]}`;
  }

  return imageUrl;
};

/**
 * Validate image file
 * @param {Object} file - Multer file object
 * @returns {Boolean} - Valid or not
 */
exports.validateImage = (file) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!allowedTypes.includes(file.mimetype)) {
    throw new ErrorResponse('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed', 400);
  }

  if (file.size > maxSize) {
    throw new ErrorResponse('File size too large. Maximum 5MB allowed', 400);
  }

  return true;
};

module.exports = exports;
