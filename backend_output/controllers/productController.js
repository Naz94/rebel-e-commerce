const Product  = require('../models/Product');
const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — STOREFRONT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Get all active products with ReDoS protection + pagination
 * @route GET /api/v1/products
 */
exports.getProducts = async (req, res) => {
  try {
    const { category, sort, search, page = 1, limit = 20 } = req.query;

    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const safePage  = Math.max(parseInt(page)  || 1,  1);
    const skip      = (safePage - 1) * safeLimit;

    const query = { clientId: req.clientId, status: 'active' };

    if (category) query.category = category;

    if (search) {
      // Escape special regex chars to prevent ReDoS
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name:        { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    let productsQuery = Product.find(query).skip(skip).limit(safeLimit);

    if      (sort === 'price_asc')  productsQuery = productsQuery.sort('price');
    else if (sort === 'price_desc') productsQuery = productsQuery.sort('-price');
    else                            productsQuery = productsQuery.sort('-createdAt');

    const [products, total] = await Promise.all([
      productsQuery,
      Product.countDocuments(query)
    ]);

    res.json({
      success: true,
      count:   products.length,
      total,
      pagination: { currentPage: safePage, totalPages: Math.ceil(total / safeLimit) },
      data:    products
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve products' });
  }
};

/**
 * @desc  Get single product by ID
 * @route GET /api/v1/products/:id
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
 * @desc  Get single product by slug
 * @route GET /api/v1/products/slug/:slug
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
 * @desc  Get featured products for storefront hero/carousel
 * @route GET /api/v1/products/featured
 */
exports.getFeaturedProducts = async (req, res) => {
  try {
    const safeLimit = Math.min(parseInt(req.query.limit) || 8, 20);
    const products  = await Product.find({
      clientId:   req.clientId,
      status:     'active',
      isFeatured: true
    })
      .sort('-createdAt')
      .limit(safeLimit);

    res.json({ success: true, count: products.length, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve featured products' });
  }
};

/**
 * @desc  Distinct product categories for storefront filters
 * @route GET /api/v1/products/categories
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct('category', {
      clientId: req.clientId,
      status:   'active',
      category: { $exists: true, $nin: [null, ''] }
    });
    res.json({ success: true, data: categories.sort() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve categories' });
  }
};

/**
 * @desc  Check availability for cart items (optimised single $in query)
 * @route POST /api/v1/products/check-availability
 */
exports.checkAvailability = async (req, res) => {
  try {
    const { items } = req.body; // [{ productId, quantity }]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    const productIds = items.map(item => item.productId);
    const products   = await Product.find({
      _id:      { $in: productIds },
      clientId: req.clientId
    }).select('stockQuantity name');

    const productMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));

    const availability = items.map(item => {
      const product = productMap[item.productId];
      return {
        productId:    item.productId,
        name:         product ? product.name : 'Unknown Product',
        available:    product ? product.stockQuantity >= item.quantity : false,
        currentStock: product ? product.stockQuantity : 0
      };
    });

    res.json({ success: true, data: availability });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Availability check failed' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Create product with mass-assignment protection
 * @route POST /api/v1/products
 */
exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, category, stockQuantity, sku, status, isFeatured, images } = req.body;

    const product = await Product.create({
      name,
      description,
      price,
      category,
      stockQuantity,
      sku,
      status:     status     || 'active',
      isFeatured: isFeatured || false,
      images:     images     || [],
      clientId:   req.clientId   // never from body
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
 * @desc  Update product with tenant boundary check and mass-assignment protection
 * @route PUT /api/v1/products/:id
 */
exports.updateProduct = async (req, res) => {
  try {
    const allowedUpdates = ['name', 'description', 'price', 'category', 'status', 'isFeatured', 'images', 'tags', 'stockQuantity'];
    const updateData     = {};
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
 * @desc  Set stock level directly (floor guard: no negatives)
 * @route PUT /api/v1/products/:id/stock
 */
exports.updateStock = async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity);

    if (isNaN(quantity) || quantity < 0) {
      return res.status(400).json({ success: false, message: 'Invalid stock quantity' });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { $set: { stockQuantity: quantity } },
      { new: true }
    );

    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Stock update failed' });
  }
};

/**
 * @desc  Bulk update products atomically
 * @route PUT /api/v1/products/bulk/update
 */
exports.bulkUpdateProducts = async (req, res) => {
  const { updates } = req.body; // [{ id, data }]

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ success: false, message: 'updates array is required' });
  }
  if (updates.length > 50) {
    return res.status(400).json({ success: false, message: 'Max 50 updates allowed per request' });
  }

  const ALLOWED_BULK_FIELDS = [
    'name', 'description', 'price', 'comparePrice', 'category',
    'status', 'stockQuantity', 'isFeatured', 'images', 'tags', 'weight', 'badge'
  ];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ops = updates.map(u => {
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
    console.error(`[BULK_UPDATE][Tenant: ${req.clientId}]:`, error.message);
    res.status(400).json({ success: false, message: 'Bulk update failed' });
  } finally {
    await session.endSession();
  }
};

/**
 * @desc  Delete product (tenant-scoped)
 * @route DELETE /api/v1/products/:id
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

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS & REPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc  Inventory health metrics: total, out-of-stock, low-stock, value
 * @route GET /api/v1/products/reports/stats
 *
 * FIX C-10: Was calling Product.aggregate() directly, bypassing the tenant
 * firewall entirely. Now uses Product.aggregateForTenant() which prepends
 * a mandatory $match on clientId — identical pattern to Order.aggregateForTenant().
 */
exports.getProductStats = async (req, res) => {
  try {
    // FIX C-10: use aggregateForTenant wrapper — never call .aggregate() directly
    const stats = await Product.aggregateForTenant(req.clientId, [
      {
        $group: {
          _id:            null,
          totalProducts:  { $sum: 1 },
          outOfStock:     { $sum: { $cond: [{ $lte: ['$stockQuantity', 0] }, 1, 0] } },
          lowStock: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$stockQuantity', 0] }, { $lte: ['$stockQuantity', 5] }] },
                1,
                0
              ]
            }
          },
          inventoryValue: { $sum: { $multiply: ['$price', '$stockQuantity'] } }
        }
      }
    ]);

    res.json({
      success: true,
      data:    stats[0] || { totalProducts: 0, outOfStock: 0, lowStock: 0, inventoryValue: 0 }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Stats retrieval failed' });
  }
};

/**
 * @desc  Products at or below reorder level
 * @route GET /api/v1/products/reports/low-stock
 */
exports.getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.getLowStock(req.clientId);
    res.json({ success: true, count: products.length, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve low-stock products' });
  }
};

/**
 * @desc  Products with zero stock
 * @route GET /api/v1/products/reports/out-of-stock
 */
exports.getOutOfStockProducts = async (req, res) => {
  try {
    const products = await Product.getOutOfStock(req.clientId);
    res.json({ success: true, count: products.length, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve out-of-stock products' });
  }
};
