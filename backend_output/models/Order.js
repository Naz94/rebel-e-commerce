const mongoose = require('mongoose');
const { TIMELINE_CAP } = require('../constants/order');

const OrderSchema = new mongoose.Schema({
  clientId: {
    type: String,
    required: true,
    index: true
  },
  orderNumber: {
    type: String,
    unique: true
  },
  customer: {
    name: String,
    email: { type: String, required: true },
    phone: String
  },
  items: [{
    product: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: String,
      sku: String
    },
    quantity: { type: Number, required: true },
    priceAtPurchase: { type: Number, required: true },
    subtotal: { type: Number, required: true },
    // FIX 1: Added missing fields that expireOrders.js relies on
    stockReserved: { type: Boolean, default: false },
    stockDeducted: { type: Boolean, default: false }
  }],
  totals: {
    subtotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    vatRate: { type: Number, default: 0.15 }
  },
  fulfillment: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'],
      default: 'pending'
    },
    trackingNumber: String,
    courier: String,
    shippedAt: Date
  },
  payment: {
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    method: String,
    transactionId: String,
    paidAt: Date
  },
  // FIX 2: Added missing timeline array that expireOrders.js pushes to
  timeline: {
    type: [{
      event: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      note: String,
      actor: String
    }],
    default: []
  },
  stockReserved: { type: Boolean, default: false },
  notes: String,
  internalTags: [String],
  lastCleanupAttempt: Date
}, { timestamps: true });

// ─────────────────────────────────────────────────────────────────────────────
// TENANT FIREWALL
// FIX 3: Allow system/cron operations to bypass via { bypassTenantFirewall: true }
// Usage: Order.find({ 'payment.status': 'pending' }).setOptions({ bypassTenantFirewall: true })
// ─────────────────────────────────────────────────────────────────────────────
OrderSchema.pre(/^find/, function (next) {
  // Allow explicit bypass for internal system operations (e.g. cron jobs)
  if (this.getOptions().bypassTenantFirewall === true) return next();

  const query = this.getQuery();
  if (query.clientId === undefined) {
    return next(new Error('Tenant Firewall: clientId is required for all Order queries.'));
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * addTimelineEvent: Safe helper that respects TIMELINE_CAP
 */
OrderSchema.methods.addTimelineEvent = function (event, note, actor) {
  if (this.timeline.length >= TIMELINE_CAP) {
    this.timeline.shift(); // Remove oldest entry to stay within cap
  }
  this.timeline.push({ event, note, actor, timestamp: new Date() });
};

/**
 * markAsPaid: Updates payment status and records transaction details.
 */
OrderSchema.methods.markAsPaid = async function (transactionId, amount, provider, { session } = {}) {
  if (this.payment.status === 'paid') return this;

  this.payment.status = 'paid';
  this.payment.transactionId = transactionId;
  this.payment.method = provider;
  this.payment.paidAt = new Date();

  this.addTimelineEvent('payment_confirmed', `Payment of ${amount} received via ${provider}. Ref: ${transactionId}`);

  return await this.save({ session });
};

/**
 * cancelOrder: Updates fulfillment status and logs the reason.
 * Note: Stock restoration is handled in the controller to maintain atomicity across models.
 */
OrderSchema.methods.cancelOrder = async function (reason, { session } = {}) {
  if (['delivered', 'cancelled'].includes(this.fulfillment.status)) {
    throw new Error(`Cannot cancel order in ${this.fulfillment.status} state.`);
  }

  this.fulfillment.status = 'cancelled';
  this.addTimelineEvent('order_cancelled', reason || 'No reason provided');

  return await this.save({ session });
};

// ─────────────────────────────────────────────────────────────────────────────
// STATIC METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createWithRetry: Generates a unique order number with a random suffix and
 * retries on collision. Resolves the race condition on orderNumber uniqueness.
 */
OrderSchema.statics.createWithRetry = async function (orderData, session, retries = 5) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let i = 0; i < retries; i++) {
    try {
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      orderData.orderNumber = `ORD-${dateStr}-${randomSuffix}`;

      const [order] = await this.create([orderData], { session });
      return order;
    } catch (error) {
      const isDuplicateKey = error.code === 11000 && error.message.includes('orderNumber');
      if (isDuplicateKey && i < retries - 1) continue;
      throw error;
    }
  }
};

/**
 * aggregateForTenant: Enforces clientId on all aggregate pipelines.
 * FIX 4: The pre(/^find/) hook does NOT fire on .aggregate(). Use this
 * static instead of calling Order.aggregate() directly.
 */
OrderSchema.statics.aggregateForTenant = function (clientId, pipeline) {
  if (!clientId) {
    throw new Error('Tenant Firewall: clientId is required for Order aggregations.');
  }
  // Prepend a $match stage to guarantee tenant scoping
  return this.aggregate([
    { $match: { clientId } },
    ...pipeline
  ]);
};

module.exports = mongoose.model('Order', OrderSchema);