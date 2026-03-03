const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema(
  {
    clientId: { 
      type: String, 
      required: true, 
      index: true 
    },
    product: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Product', 
      required: true, 
      index: true 
    },
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    rating: { 
      type: Number, 
      required: [true, 'Rating (1-5) is required'], 
      min: 1, 
      max: 5, 
      index: true 
    },
    title: { 
      type: String, 
      trim: true, 
      maxlength: 100 
    },
    comment: { 
      type: String, 
      required: [true, 'Review text is required'] 
    },
    status: { 
      type: String, 
      enum: ['pending', 'approved', 'rejected'], 
      default: 'pending', 
      index: true 
    },
    isVerifiedPurchase: { 
      type: Boolean, 
      default: false 
    },
    helpfulVotes: { 
      type: Number, 
      default: 0, 
      min: 0 
    }
  },
  { 
    timestamps: true 
  }
);

// =====================
// INDEXES
// =====================

/**
 * Prevents duplicate reviews per user/product within a specific tenant.
 * Note: product is leading to optimize for product-page review queries.
 */
ReviewSchema.index({ product: 1, user: 1, clientId: 1 }, { unique: true });

// =====================
// TENANT ISOLATION (PRE-HOOKS)
// =====================

/**
 * Hard Tenant Isolation Firewall.
 * Blocks any Query operation missing a clientId filter to prevent data leakage.
 * NOTE: This will block .populate() calls unless they include match: { clientId }.
 */
const enforceTenantIsolation = function (next) {
  const filter = this.getFilter();
  if (!filter || !filter.clientId) {
    return next(new Error('[TENANT_VIOLATION] Operation blocked: clientId filter is mandatory.'));
  }
  next();
};

const isolationMethods = [
  'find', 
  'findOne', 
  'findOneAndUpdate', 
  'findOneAndDelete', 
  'updateMany', 
  'deleteMany', 
  'countDocuments'
];

isolationMethods.forEach(method => {
  ReviewSchema.pre(method, enforceTenantIsolation);
});

// =====================
// STATIC METHODS
// =====================

ReviewSchema.statics.updateProductStats = async function (clientId, productId) {
  const Product = mongoose.model('Product');
  /**
   * Delegates aggregation to the Product model.
   * Passes true to enable throwOnError for middleware observability.
   */
  await Product.syncReviewStats(clientId, productId, true);
};

// =====================
// SYNC MIDDLEWARE (POST-HOOKS)
// =====================

/**
 * Validation helper to ensure sync only targets a specific single product.
 */
const isValidSyncTarget = (clientId, product) => {
  return clientId && product && mongoose.isValidObjectId(product);
};

/**
 * Shared Sync Handler for Query operations.
 * Extracts IDs from doc or filter and handles fallback logic.
 */
const handleQuerySync = async function (doc, opLabel) {
  try {
    const filter = this.getFilter();
    const clientId = doc?.clientId ?? filter.clientId;
    const product = doc?.product ?? filter.product;

    if (isValidSyncTarget(clientId, product)) {
      await mongoose.model('Review').updateProductStats(clientId, product);
    } else if (['updateMany', 'deleteMany'].includes(opLabel)) {
      console.warn(`[SYNC_SKIP][${opLabel}] Skipped stats sync: Filter is not specific to one product.`);
    }
  } catch (err) {
    console.error(`[MIDDLEWARE_ERROR][Review_${opLabel || 'Query'}_Sync]:`, err.message);
  }
};

/**
 * Sync on Save
 */
ReviewSchema.post('save', async function () {
  try {
    await this.constructor.updateProductStats(this.clientId, this.product);
  } catch (err) {
    console.error('[MIDDLEWARE_ERROR][Review_Save_Sync]:', err.message);
  }
});

/**
 * Explicit registration for Mongoose version compatibility and context stability.
 */
ReviewSchema.post('findOneAndUpdate', function(doc) { 
  return handleQuerySync.call(this, doc, 'findOneAndUpdate'); 
});

ReviewSchema.post('findOneAndDelete', function(doc) { 
  return handleQuerySync.call(this, doc, 'findOneAndDelete'); 
});

ReviewSchema.post('updateMany', function(res) { 
  return handleQuerySync.call(this, res, 'updateMany'); 
});

ReviewSchema.post('deleteMany', function(res) { 
  return handleQuerySync.call(this, res, 'deleteMany'); 
});

module.exports = mongoose.model('Review', ReviewSchema);