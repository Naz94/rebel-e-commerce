const cron = require('node-cron');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');

// =====================
// CONFIGURATION
// =====================
const EXPIRY_WINDOW_MS = parseInt(process.env.ORDER_EXPIRY_MS) || 2 * 60 * 60 * 1000;
const COOLDOWN_MS = parseInt(process.env.CLEANUP_COOLDOWN_MS) || 1 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const MAX_FAILURES_BEFORE_ALERT = 3;

let isRunning = false;
let consecutiveFailures = 0;

/**
 * performAtomicCleanup
 * Atomically restores stock and marks the order as expired.
 */
const performAtomicCleanup = async (orderId, session) => {
  // FIX 1: Use bypassTenantFirewall so the cron job (which has no clientId context)
  // can fetch orders across all tenants safely. clientId is validated per-item below.
  const order = await Order.findById(orderId)
    .session(session)
    .setOptions({ bypassTenantFirewall: true });

  if (!order || order.payment.status !== 'pending') return false;

  // FIX 2: stockReserved and stockDeducted now exist on order.items (see Order.js schema).
  // Restore stock only for items that were reserved but not yet deducted.
  for (const item of order.items) {
    if (item.stockReserved && !item.stockDeducted) {
      await Product.updateOne(
        {
          _id: item.product.id,
          clientId: order.clientId // Multi-tenant guard: prevent cross-tenant stock corruption
        },
        { $inc: { stockQuantity: item.quantity } },
        { session }
      );
    }
  }

  // FIX 3: Use addTimelineEvent() helper (which respects TIMELINE_CAP) instead of
  // directly pushing to order.timeline — the field now exists in the schema.
  order.addTimelineEvent(
    'system_expiry',
    'Inventory released: Payment window expired.'
  );

  order.payment.status = 'failed';
  order.fulfillment.status = 'cancelled';
  order.stockReserved = false;
  order.items.forEach(item => {
    item.stockReserved = false;
  });
  order.lastCleanupAttempt = new Date();

  await order.save({ session });
  return true;
};

const startOrderExpiryJob = () => {
  cron.schedule('*/30 * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    const expiryThreshold = new Date(Date.now() - EXPIRY_WINDOW_MS);
    const cooldownThreshold = new Date(Date.now() - COOLDOWN_MS);

    let successCount = 0;
    let failCount = 0;

    try {
      // FIX 4: This is a system-level cross-tenant sweep — bypass the tenant firewall
      const staleOrders = await Order.find({
        'payment.status': 'pending',
        createdAt: { $lt: expiryThreshold },
        $or: [
          { lastCleanupAttempt: { $exists: false } },
          { lastCleanupAttempt: { $lt: cooldownThreshold } }
        ]
      })
        .select('_id')
        .sort({ createdAt: 1 })
        .limit(BATCH_SIZE)
        .lean()
        .setOptions({ bypassTenantFirewall: true });

      if (staleOrders.length === 0) {
        consecutiveFailures = 0;
        return;
      }

      if (staleOrders.length === BATCH_SIZE) {
        console.warn(`[CRON_WARN] Batch limit (${BATCH_SIZE}) reached. Backlog may exist.`);
      }

      for (const orderRef of staleOrders) {
        const orderSession = await mongoose.startSession();
        try {
          await orderSession.withTransaction(async () => {
            await performAtomicCleanup(orderRef._id, orderSession);
          });
          successCount++;
        } catch (err) {
          failCount++;
          console.error(`[CRON_ERR] Cleanup failed for ${orderRef._id}:`, err.message);

          // Stamp lastCleanupAttempt to prevent infinite retry loops on broken orders
          try {
            await Order.updateOne(
              { _id: orderRef._id },
              { $set: { lastCleanupAttempt: new Date() } },
              { bypassTenantFirewall: true }
            );
          } catch (stampErr) {
            console.error(`[CRON_ERR] Stamp failed:`, stampErr.message);
          }
        } finally {
          await orderSession.endSession();
        }
      }

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        context: 'ORDER_EXPIRY_JOB',
        batchSize: staleOrders.length,
        succeeded: successCount,
        failed: failCount
      }));

      consecutiveFailures = failCount > 0 ? consecutiveFailures + 1 : 0;

    } catch (error) {
      consecutiveFailures++;
      console.error(`[CRON_FATAL]:`, error.stack);
    } finally {
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
        console.error(`[CRON_ALERT] Systemic failure: ${consecutiveFailures} consecutive batches with errors.`);
      }
      isRunning = false;
    }
  });
};

module.exports = startOrderExpiryJob;