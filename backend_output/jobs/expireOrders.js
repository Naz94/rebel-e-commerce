const cron     = require('node-cron');
const mongoose = require('mongoose');
const Order    = require('../models/Order');
const Product  = require('../models/Product');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const EXPIRY_WINDOW_MS         = parseInt(process.env.ORDER_EXPIRY_MS)      || 2 * 60 * 60 * 1000; // 2 h
const COOLDOWN_MS              = parseInt(process.env.CLEANUP_COOLDOWN_MS)  || 1 * 60 * 60 * 1000; // 1 h
const BATCH_SIZE               = 50;
const MAX_FAILURES_BEFORE_ALERT = 3;

let isRunning          = false;
let consecutiveFailures = 0;

// ─────────────────────────────────────────────────────────────────────────────
// performAtomicCleanup
// Restores stock and marks the order as expired — all inside a single
// session transaction passed in by the caller.
// ─────────────────────────────────────────────────────────────────────────────
const performAtomicCleanup = async (orderId, session) => {
  // System-level lookup: no clientId in cron context — bypass firewall.
  // clientId is validated per-item inside the loop below.
  const order = await Order.findById(orderId)
    .session(session)
    .setOptions({ bypassTenantFirewall: true });

  // Idempotency: skip if already processed or no longer pending
  if (!order || order.payment.status !== 'pending') return false;

  // Restore stock only for items where stock was reserved but NOT yet
  // deducted. This is the complement of the cancelOrder path (which handles
  // items where stockDeducted === true). Together they cover all cases
  // without double-restoring.
  for (const item of order.items) {
    if (item.stockReserved && !item.stockDeducted) {
      await Product.updateOne(
        {
          _id:      item.product.id,
          clientId: order.clientId  // per-item tenant guard prevents cross-tenant corruption
        },
        { $inc: { stockQuantity: item.quantity } },
        { session }
      );
    }
  }

  order.addTimelineEvent('system_expiry', 'Inventory released: Payment window expired.');

  order.payment.status     = 'failed';
  order.fulfillment.status = 'cancelled';
  order.stockReserved      = false;
  order.items.forEach(item => { item.stockReserved = false; });
  order.lastCleanupAttempt = new Date();

  await order.save({ session });
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// CRON JOB — runs every 30 minutes
// ─────────────────────────────────────────────────────────────────────────────
const startOrderExpiryJob = () => {
  cron.schedule('*/30 * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    const expiryThreshold   = new Date(Date.now() - EXPIRY_WINDOW_MS);
    const cooldownThreshold = new Date(Date.now() - COOLDOWN_MS);

    let successCount = 0;
    let failCount    = 0;

    try {
      // Cross-tenant sweep — explicit bypass required
      const staleOrders = await Order.find({
        'payment.status': 'pending',
        createdAt:        { $lt: expiryThreshold },
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

          // Stamp lastCleanupAttempt to prevent infinite retry on a persistently
          // broken order. Uses setOptions() — NOT the options argument of updateOne —
          // so the bypass is correctly recognised by the tenant firewall plugin.
          //
          // FIX C-7: The original code passed { bypassTenantFirewall: true } as the
          // third argument to updateOne(), which Mongoose treats as query options
          // (e.g. writeConcern, session), NOT as setOptions(). The tenant firewall
          // pre-hook reads options via this.getOptions(), which only reflects what
          // was set through setOptions(). Passing it as a plain object is silently
          // ignored by the hook, meaning the update would be blocked in environments
          // where the global tenant plugin is active.
          try {
            await Order.updateOne(
              { _id: orderRef._id },
              { $set: { lastCleanupAttempt: new Date() } }
            ).setOptions({ bypassTenantFirewall: true });
          } catch (stampErr) {
            console.error('[CRON_ERR] Stamp failed:', stampErr.message);
          }
        } finally {
          await orderSession.endSession();
        }
      }

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        context:   'ORDER_EXPIRY_JOB',
        batchSize: staleOrders.length,
        succeeded: successCount,
        failed:    failCount
      }));

      // Reset consecutive-failure counter only when the entire batch is clean
      consecutiveFailures = failCount > 0 ? consecutiveFailures + 1 : 0;

    } catch (error) {
      consecutiveFailures++;
      console.error('[CRON_FATAL]:', error.stack);
    } finally {
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
        console.error(
          `[CRON_ALERT] Systemic failure: ${consecutiveFailures} consecutive batches with errors.`
        );
      }
      isRunning = false;
    }
  });
};

module.exports = startOrderExpiryJob;
