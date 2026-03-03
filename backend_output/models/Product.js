const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    name: { type: String, required: [true, 'Product name is required'], trim: true },
    slug: { type: String },
    description: String,
    shortDescription: String,
    price: { type: Number, required: true, min: 0 },
    cost: { type: Number, min: 0 },
    stockQuantity: { type: Number, required: true, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 10, min: 0 },
    category: String,
    tags: [String],
    images: [
      {
        url: { type: String, required: true },
        alt: String,
        isPrimary: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
        cloudinaryId: String
      }
    ],
    seo: {
      metaTitle: String,
      metaDescription: String,
      keywords: [String]
    },
    details: {
      size: String,
      materials: [String],
      colors: [String],
      notes: { top: [String], middle: [String], base: [String] }
    },
    isFeatured: { type: Boolean, default: false },
    promotion: {
      discountPercent: { type: Number, min: 0, max: 100 },
      startDate: Date,
      endDate: Date
    },
    status: { 
      type: String, 
      enum: ['active', 'archived', 'draft'], 
      default: 'active', 
      index: true 
    },
    views: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviews: { type: Number, default: 0 },
    sku: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// =====================
// INDEXES
// =====================

// Merchant-scoped SKU uniqueness
ProductSchema.index({ clientId: 1, sku: 1 }, { unique: true });

// Merchant-scoped Slug uniqueness (only for active products)
ProductSchema.index(
  { clientId: 1, slug: 1 }, 
  { unique: true, partialFilterExpression: { status: 'active' } }
);

// =====================
// UTILS
// =====================

const generateSlug = (name) => {
  return name.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

const validatePromotionDates = (start, end) => {
  if (start && end && new Date(end) <= new Date(start)) {
    throw new Error('Promotion end date must be after start date.');
  }
};

// =====================
// MIDDLEWARE
// =====================

ProductSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  const options = this.getOptions();
  if (!update.$set) update.$set = {};

  if (options.userId) update.$set.updatedBy = options.userId;

  const name = update.name || update.$set.name;
  if (name) update.$set.slug = generateSlug(name);

  const start = update.promotion?.startDate || update.$set.promotion?.startDate || update.$set['promotion.startDate'];
  const end = update.promotion?.endDate || update.$set.promotion?.endDate || update.$set['promotion.endDate'];
  
  try {
    validatePromotionDates(start, end);
  } catch (err) {
    return next(err);
  }
  next();
});

ProductSchema.pre('save', function (next) {
  if (this._userId) {
    if (this.isNew) this.createdBy = this._userId;
    else this.updatedBy = this._userId;
    // Fix 4: Set to undefined for reliable Mongoose tracking over 'delete'
    this._userId = undefined; 
  }

  try {
    validatePromotionDates(this.promotion?.startDate, this.promotion?.endDate);
  } catch (err) {
    return next(err);
  }
  
  if (this.isModified('name')) {
    this.slug = generateSlug(this.name);
  }
  next();
});

// =====================
// METHODS
// =====================

/**
 * Fix 5: Write-scoped tenant guard.
 */
ProductSchema.methods.incrementViews = async function () {
  return mongoose.model('Product').updateOne(
    { _id: this._id, clientId: this.clientId },
    { $inc: { views: 1 } }
  );
};

/**
 * Fix 5: Atomic Stock Adjustment with Tenant Firewall.
 * Scoping by clientId prevents cross-merchant document mutation.
 */
ProductSchema.methods.adjustStock = async function (quantity, userId = null) {
  if (quantity === 0) return this;
  
  const query = { _id: this._id, clientId: this.clientId };
  
  if (quantity < 0) {
    query.stockQuantity = { $gte: Math.abs(quantity) };
  }

  const update = { $inc: { stockQuantity: quantity } };
  if (userId) update.$set = { updatedBy: userId };

  const updatedDoc = await mongoose.model('Product').findOneAndUpdate(
    query, 
    update, 
    { new: true, runValidators: true }
  );

  if (!updatedDoc) {
    throw new Error('Stock adjustment failed: Insufficient stock or merchant/product mismatch.');
  }
  this.stockQuantity = updatedDoc.stockQuantity;
  return this;
};

ProductSchema.methods.decreaseStock = async function (quantity, userId = null) {
  return this.adjustStock(-quantity, userId);
};

ProductSchema.methods.increaseStock = async function (quantity, userId = null) {
  return this.adjustStock(quantity, userId);
};

// =====================
// STATIC METHODS
// =====================

/**
 * syncReviewStats
 * Fix 1 & 2: Defensive guards and intentional aggregate scoping.
 */
ProductSchema.statics.syncReviewStats = async function(clientId, productId, throwOnError = false) {
  // Guard against undefined inputs that could cause cross-tenant leaks or query failure
  if (!clientId || !productId) {
    const err = new Error('[SYNC_ERROR] Operation aborted: clientId and productId are required.');
    console.error(err.message);
    if (throwOnError) throw err;
    return;
  }

  try {
    const Review = mongoose.model('Review');
    
    /**
     * NOTE: Review.aggregate() bypasses pre-hooks. 
     * Explicit clientId in $match is the primary security boundary here.
     */
    const stats = await Review.aggregate([
      { 
        $match: { 
          clientId: clientId, 
          product: new mongoose.Types.ObjectId(productId), 
          status: 'approved' 
        } 
      },
      { 
        $group: { 
          _id: '$product', 
          avgRating: { $avg: '$rating' }, 
          totalReviews: { $sum: 1 } 
        } 
      }
    ]);

    const update = stats.length > 0 
      ? { 
          rating: parseFloat(stats[0].avgRating.toFixed(1)), 
          reviews: stats[0].totalReviews 
        }
      : { rating: 0, reviews: 0 };

    await this.findOneAndUpdate({ _id: productId, clientId }, update);
    
  } catch (error) {
    console.error(`[SYNC_ENGINE_FAILURE][${productId}]:`, error.message);
    if (throwOnError) throw error; 
  }
};

/**
 * Fix 3: Read-scoped tenant guards for merchant dashboards.
 */
ProductSchema.statics.getLowStock = function (clientId) {
  if (!clientId) throw new Error('[TENANT_ERROR] Operation blocked: clientId is required for stock queries.');
  return this.find({ clientId, status: 'active', $expr: { $lte: ['$stockQuantity', '$reorderLevel'] } });
};

ProductSchema.statics.getOutOfStock = function (clientId) {
  if (!clientId) throw new Error('[TENANT_ERROR] Operation blocked: clientId is required for stock queries.');
  return this.find({ clientId, status: 'active', stockQuantity: 0 });
};

module.exports = mongoose.model('Product', ProductSchema);