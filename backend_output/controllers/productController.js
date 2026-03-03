const Product = require('../models/Product');
const mongoose = require('mongoose');

// =====================
// PUBLIC METHODS
// =====================

/**
 * @desc    Get all products (Storefront) with ReDoS protection & Pagination
 * @route   GET /api/products
 */
exports.getProducts = async (req, res) => {
  try {
    const { category, sort, search, page = 1, limit = 20 } = req.query;
    
    // FIX: Pagination Cap to prevent memory exhaustion
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    let query = { clientId: req.clientId, status: 'active' };

    if (category) query.category = category;
    
    if (search) {
      // FIX: ReDoS protection - Escape special regex characters
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    let productsQuery = Product.find(query)
      .skip(skip)
      .limit(safeLimit);

    if (sort === 'price_asc') productsQuery = productsQuery.sort('price');
    else if (sort === 'price_desc') productsQuery = productsQuery.sort('-price');
    else productsQuery = productsQuery.sort('-createdAt');

    const products = await productsQuery;
    const total = await Product.countDocuments(query);

    res.json({
      success: true,
      count: products.length,
      total,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit)
      },
      data: products
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve products' });
  }
};

/**
 * @desc    Get single product by ID
 */
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, clientId: req.clientId });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Product retrieval failed' });
  }
};

/**
 * @desc    Get single product by Slug
 */
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, clientId: req.clientId });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Product retrieval failed' });
  }
};

/**
 * @desc    Check product availability (Optimized $in query)
 * @route   POST /api/products/check-availability
 */
exports.checkAvailability = async (req, res) => {
  try {
    const { items } = req.body; // Expects [{ productId, quantity }]
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // FIX: Performance optimization - replace loop with single $in query
    const productIds = items.map(item => item.productId);
    const products = await Product.find({
      _id: { $in: productIds },
      clientId: req.clientId
    }).select('stockQuantity name');

    const productMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));

    const availability = items.map(item => {
      const product = productMap[item.productId];
      return {
        productId: item.productId,
        name: product ? product.name : 'Unknown Product',
        available: product ? product.stockQuantity >= item.quantity : false,
        currentStock: product ? product.stockQuantity : 0
      };
    });

    res.json({ success: true, data: availability });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Availability check failed' });
  }
};

// =====================
// ADMIN METHODS
// =====================

/**
 * @desc    Create product with Mass Assignment protection
 */
exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, category, stockQuantity, status, isFeatured, images } = req.body;

    // FIX: Explicit field whitelisting (Mass Assignment Guard)
    const product = await Product.create({
      name,
      description,
      price,
      category,
      stockQuantity,
      status: status || 'active',
      isFeatured: isFeatured || false,
      images: images || [],
      clientId: req.clientId
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    const isValidationError = error.name === 'ValidationError';
    res.status(400).json({ 
      success: false, 
      message: isValidationError ? error.message : 'Product creation failed' 
    });
  }
};

/**
 * @desc    Update product with tenant boundary check
 */
exports.updateProduct = async (req, res) => {
  try {
    // Whitelist updates to prevent clientId or internal field manipulation
    const allowedUpdates = ['name', 'description', 'price', 'category', 'status', 'isFeatured', 'images'];
    const updateData = {};
    
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) updateData[key] = req.body[key];
    });

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Update failed' });
  }
};

/**
 * @desc    Update stock directly with floor guard
 */
exports.updateStock = async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity);
    
    // FIX: Negative quantity guard
    if (isNaN(quantity) || quantity < 0) {
      return res.status(400).json({ success: false, message: 'Invalid stock quantity' });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { $set: { stockQuantity: quantity } },
      { new: true }
    );

    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Stock update failed' });
  }
};

/**
 * @desc    Bulk update products with transaction atomicity
 */
exports.bulkUpdateProducts = async (req, res) => {
  const { updates } = req.body; // Expects [{ id, data }]
  
  if (!Array.isArray(updates) || updates.length > 50) {
    return res.status(400).json({ success: false, message: 'Max 50 updates allowed' });
  }

  const session = await mongoose.startSession();
  try {
    // FIX: Transactional integrity for bulk writes
    const ALLOWED_BULK_FIELDS = [
      'name','description','price','comparePrice','category',
      'status','stockQuantity','isFeatured','images','tags','weight','badge'
    ];

    await session.withTransaction(async () => {
      const ops = updates.map(u => {
        // Whitelist: prevents clientId injection or arbitrary field writes
        const safe = {};
        ALLOWED_BULK_FIELDS.forEach(f => {
          if (u.data[f] !== undefined) safe[f] = u.data[f];
        });
        return {
          updateOne: {
            filter: { _id: u.id, clientId: req.clientId },
            update: { $set: safe }
          }
        };
      });

      const result = await Product.bulkWrite(ops, { session });
      
      if (result.matchedCount !== updates.length) {
        throw new Error('Partial update failure: invalid product ID or tenant mismatch');
      }
    });

    res.json({ success: true, message: 'Bulk update successful' });
  } catch (error) {
    console.error(`Bulk Update Error [Tenant: ${req.clientId}]:`, error.message);
    res.status(400).json({ success: false, message: 'Bulk update failed' });
  } finally {
    await session.endSession();
  }
};

/**
 * @desc    Delete product (Tenant Scoped)
 */
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, clientId: req.clientId });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Deletion failed' });
  }
};

// =====================
// ANALYTICS & REPORTS
// =====================

/**
 * @desc    Get low stock/inventory metrics
 */
exports.getProductStats = async (req, res) => {
  try {
    const stats = await Product.aggregate([
      { $match: { clientId: req.clientId } }, 
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          outOfStock: { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
          lowStock: { $sum: { $cond: [{ $lte: ['$stockQuantity', 5] }, 1, 0] } },
          inventoryValue: { $sum: { $multiply: ['$price', '$stockQuantity'] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || { totalProducts: 0, outOfStock: 0, lowStock: 0, inventoryValue: 0 }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Stats retrieval failed' });
  }
};