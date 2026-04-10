const mongoose = require('mongoose');
const { TIMELINE_CAP } = require('../constants/order');

const OrderSchema = new mongoose.Schema({
  clientId: {
    type:     String,
    required: true,
    index:    true
  },
  orderNumber: {
    type:   String,
    unique: true
  },
  customer: {
    name:  String,
    email: { type: String, required: true },
    phone: String
  },
  items: [{
    product: {
      id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: String,
      sku:  String
    },
    quantity:        { type: Number, required: true },
    priceAtPurchase: { type: Number, required: true },
    subtotal:        { type: Number, required: true },
    // Tracks whether stock was taken at order time — used by expiry cron
    // to decide whether to restore it. Both are true immediately on order
    // creation (atomic deduction model). Only reserved && !deducted orders
    // get stock restored on expiry.
    stockReserved: { type: Boolean, default: false },
    stockDeducted: { type: Boolean, default: false }
  }],
  totals: {
    subtotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    tax:      { type: Number, default: 0 },
    total:    { type: Number, default: 0 },
    vatRate:  { type: Number, default: 0.15 }
  },
  fulfillment: {
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'],
      default: 'pending'
    },
    trackingNumber: String,
    courier:        String,
    shippedAt:      Date
  },
  payment: {
    status: {
      type:    String,
      enum:    ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    method:        String,
    transactionId: String,
    paidAt:        Date
  },
  // Timeline of state changes, capped at TIMELINE_CAP entries
  timeline: {
    type: [{
      event:     { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      note:      String,
      actor:     String
    }],
    default: []
  },
  // FIX H-2: eftDetails was written by createOrder but had no schema definition.
  // Mongoose strict mode silently drops undefined fields — this caused banking
  // details to never persist to the DB.
  eftDetails: {
    bankName:      String,
    accountHolder: String,
    accountNumber: String,
    branchCode:    String,
    reference:     String
  },
  // Top-level flag summarising item-level stockReserved state
  stockReserved:      { type: Boolean, default: false },
  notes:              String,
  internalTags:       [String],
  lastCleanupAttempt: Date,
  billingAddress:     mongoose.Schema.Types.Mixed,
  shippingAddress:    mongoose.Schema.Types.Mixed
}, { timestamps: true });

// ─────────────────────────────────────────────────────────────────────────────
// TENANT FIREWALL
// Any find* query without clientId is rejected unless the caller explicitly
// opts out with .setOptions({ bypassTenantFirewall: true }).
// Allowed bypasses: cron jobs, migration scripts, system-level operations.
// ─────────────────────────────────────────────────────────────────────────────
OrderSchema.pre(/^find/, function (next) {
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
 * addTimelineEvent — respects TIMELINE_CAP by evicting the oldest entry.
 */
OrderSchema.methods.addTimelineEvent = function (event, note, actor) {
  if (this.timeline.length >= TIMELINE_CAP) {
    this.timeline.shift();
  }
  this.timeline.push({ event, note, actor, timestamp: new Date() });
};

/**
 * markAsPaid — idempotent: returns immediately if already paid.
 * This is the canonical path for ALL payment confirmations.
 */
OrderSchema.methods.markAsPaid = async function (transactionId, amount, provider, { session } = {}) {
  // Idempotency guard — never double-process
  if (this.payment.status === 'paid') return this;

  this.payment.status        = 'paid';
  this.payment.transactionId = transactionId;
  this.payment.method        = provider;
  this.payment.paidAt        = new Date();

  this.addTimelineEvent(
    'payment_confirmed',
    `Payment of ${amount} received via ${provider}. Ref: ${transactionId}`
  );

  return await this.save({ session });
};

/**
 * cancelOrder — guards against re-cancelling delivered or already-cancelled orders.
 * Stock restoration is handled in the calling controller to maintain atomicity.
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
 * createWithRetry — generates a unique orderNumber with a random suffix and
 * retries up to `retries` times on a duplicate-key collision.
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
 * aggregateForTenant — prepends a $match on clientId so the tenant firewall
 * is enforced even though pre(/^find/) does NOT fire for .aggregate() calls.
 */
OrderSchema.statics.aggregateForTenant = function (clientId, pipeline) {
  if (!clientId) {
    throw new Error('Tenant Firewall: clientId is required for Order aggregations.');
  }
  return this.aggregate([
    { $match: { clientId } },
    ...pipeline
  ]);
};

module.exports = mongoose.model('Order', OrderSchema);
