const mongoose  = require('mongoose');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const Customer  = require('../models/Customer');
const {
  VAT_RATE,
  MAX_CART_LINE_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  MAX_AGGREGATE_QUANTITY
} = require('../constants/order');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validateOrderInput = (body) => {
  if (!body.customer?.email || !validateEmail(body.customer.email)) return 'Valid customer email required';
  if (!Array.isArray(body.items) || !body.items.length)             return 'Order items cannot be empty';
  if (body.items.length > MAX_CART_LINE_ITEMS)                      return 'Order exceeds line item limit';

  let aggregateQty = 0;
  for (const item of body.items) {
    if (!item.product?.id)                                          return 'Product ID is required for all items';
    if (!Number.isInteger(item.quantity) || item.quantity < 1)      return 'Invalid quantity';
    if (item.quantity > MAX_QUANTITY_PER_ITEM)                      return 'Per-item quantity limit exceeded';
    aggregateQty += item.quantity;
  }
  if (aggregateQty > MAX_AGGREGATE_QUANTITY)                        return 'Total aggregate quantity limit exceeded';
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL ORDERS
// ─────────────────────────────────────────────────────────────────────────────
exports.getAllOrders = async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page)  || 1,   1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip  = (page - 1) * limit;

    const filter = { clientId: req.clientId };

    if (req.query.days) {
      // H-4 upper-bound applied here too for consistency
      const days  = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
      const since = new Date();
      since.setDate(since.getDate() - days);
      filter.createdAt = { $gte: since };
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      pagination: { total, page, pages: Math.ceil(total / limit) },
      data: orders
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE ORDER
// ─────────────────────────────────────────────────────────────────────────────
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, clientId: req.clientId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error retrieving order' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE ORDER — atomic stock deduction + order creation
// Normalises frontend payload variants before processing.
// ─────────────────────────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  // ── Normalise frontend payload ──────────────────────────────────────────────
  const body = req.body;

  if (!body.customer && (body.email || body.customerName)) {
    body.customer = {
      name:  body.customerName || '',
      email: body.email        || '',
      phone: body.phone        || ''
    };
  }

  // Support frontend shape: [{ productId, quantity }]
  if (Array.isArray(body.items) && body.items.length && body.items[0].productId !== undefined) {
    body.items = body.items.map(i => ({
      product:  { id: i.productId || i.id },
      quantity: i.quantity || i.qty || 1
    }));
  }

  if (!body.shippingAddress && body.address) body.shippingAddress = body.address;

  const validationError = validateOrderInput(body);
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  const session = await mongoose.startSession();
  try {
    let finalOrder;

    await session.withTransaction(async () => {
      const { items, customer, billingAddress, shippingAddress, pricing, payment, fulfillment } = body;
      const processedItems = [];
      let subtotalExcl     = 0;

      for (const item of items) {
        // Atomic: find product with sufficient stock AND decrement in one operation
        const product = await Product.findOneAndUpdate(
          {
            _id:           item.product.id,
            clientId:      req.clientId,
            stockQuantity: { $gte: item.quantity },
            status:        'active'
          },
          { $inc: { stockQuantity: -item.quantity } },
          { session, new: true }
        ).lean();

        if (!product) throw new Error(`STOCKS_CHANGED:${item.product.id}`);

        const itemTotal  = product.price * item.quantity;
        subtotalExcl    += itemTotal;

        processedItems.push({
          product:         { id: product._id, name: product.name, sku: product.sku },
          quantity:        item.quantity,
          priceAtPurchase: product.price,
          subtotal:        parseFloat(itemTotal.toFixed(2)),
          // Both flags true: stock is deducted immediately at order creation
          stockReserved: true,
          stockDeducted: true
        });
      }

      const shippingExcl = pricing?.shipping || 0;
      const totalTax     = parseFloat(((subtotalExcl + shippingExcl) * VAT_RATE).toFixed(2));
      const finalTotal   = parseFloat((subtotalExcl + shippingExcl + totalTax).toFixed(2));

      const paymentMethod = payment?.method || body.paymentMethod || 'eft';

      let eftDetails;
      if (paymentMethod === 'eft' && req.client?.banking) {
        const b = req.client.banking;
        eftDetails = {
          bankName:      b.bankName,
          accountHolder: b.accountHolder,
          accountNumber: b.accountNumber,
          branchCode:    b.branchCode,
          reference:     `${b.eftReferencePrefix || 'ORD'}-TBD`
        };
      }

      finalOrder = await Order.createWithRetry({
        clientId: req.clientId,
        customer,
        items:    processedItems,
        billingAddress,
        shippingAddress,
        totals: {
          subtotal: parseFloat(subtotalExcl.toFixed(2)),
          shipping: parseFloat(shippingExcl.toFixed(2)),
          tax:      totalTax,
          total:    finalTotal,
          vatRate:  VAT_RATE
        },
        payment: {
          status: 'pending',
          method: paymentMethod
        },
        fulfillment:        fulfillment || { status: 'pending' },
        lastCleanupAttempt: new Date(),
        eftDetails
      }, session);

      // Patch EFT reference now that orderNumber has been assigned
      if (eftDetails && finalOrder.eftDetails) {
        finalOrder.eftDetails.reference =
          `${req.client.banking.eftReferencePrefix || 'ORD'}-${finalOrder.orderNumber}`;
        await finalOrder.save({ session });
      }
    });

    return res.status(201).json({ success: true, order: finalOrder, data: finalOrder });
  } catch (error) {
    const isStockOut = error.message?.startsWith('STOCKS_CHANGED:');
    return res.status(isStockOut ? 409 : 500).json({
      success: false,
      message: isStockOut
        ? 'A product ran out of stock during checkout.'
        : 'Order creation failed.'
    });
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE ORDER (metadata only — no financial fields)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateOrder = async (req, res) => {
  try {
    const allowedUpdates = {};
    if (req.body.customer?.phone)     allowedUpdates['customer.phone'] = req.body.customer.phone;
    if (req.body.shippingAddress)     allowedUpdates.shippingAddress   = req.body.shippingAddress;
    if (req.body.notes !== undefined) allowedUpdates.notes             = req.body.notes;
    if (req.body.internalTags)        allowedUpdates.internalTags      = req.body.internalTags;

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MARK AS PAID (manual / admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.markAsPaid = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let paidOrder;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: req.params.id, clientId: req.clientId }).session(session);
      if (!order) throw new Error('Order not found');
      const { transactionId, provider } = req.body;
      paidOrder = await order.markAsPaid(transactionId, order.totals.total, provider || 'manual', { session });
    });

    // Update customer lifetime stats — non-critical, intentionally outside transaction
    if (paidOrder?.customer?.email) {
      try {
        const customer = await Customer.findOne({ email: paidOrder.customer.email, clientId: req.clientId });
        if (customer) await customer.updateStatsAfterOrder(paidOrder.totals.total);
      } catch (statsErr) {
        console.error(`[STATS_UPDATE_FAIL] Order ${paidOrder._id}:`, statsErr.message);
      }
    }

    return res.json({ success: true, data: paidOrder });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SALES STATS
// FIX H-4: days query param is now capped at 365 to prevent full-collection
// scans caused by an integer overflow or deliberately large value.
// ─────────────────────────────────────────────────────────────────────────────
exports.getSalesStats = async (req, res) => {
  try {
    const matchExtra = {};
    if (req.query.days) {
      // FIX H-4: clamp between 1 and 365 days
      const days  = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
      const since = new Date();
      since.setDate(since.getDate() - days);
      matchExtra.createdAt = { $gte: since };
    }

    const stats = await Order.aggregateForTenant(req.clientId, [
      { $match: { 'payment.status': 'paid', ...matchExtra } },
      {
        $group: {
          _id:           null,
          totalRevenue:  { $sum: '$totals.total' },
          totalOrders:   { $sum: 1 },
          avgOrderValue: { $avg: '$totals.total' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: stats[0] || { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate stats' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE FULFILLMENT
// ─────────────────────────────────────────────────────────────────────────────
exports.updateFulfillment = async (req, res) => {
  const { id }                           = req.params;
  const { status, trackingNumber, courier } = req.body;

  const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid fulfillment status' });
  }

  const session = await mongoose.startSession();
  try {
    let updatedOrder;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, clientId: req.clientId }).session(session);
      if (!order) throw new Error('Order not found');

      const current = order.fulfillment.status;
      if (current === 'delivered' && status !== 'delivered') throw new Error('Cannot revert delivered status');
      if (current === 'cancelled')                           throw new Error('Cannot update cancelled order');

      order.fulfillment.status = status;
      if (trackingNumber) order.fulfillment.trackingNumber = trackingNumber;
      if (courier)        order.fulfillment.courier        = courier;
      if (status === 'shipped' || status === 'delivered') {
        order.fulfillment.shippedAt = order.fulfillment.shippedAt || new Date();
      }
      order.addTimelineEvent('fulfillment_updated', `Status changed to ${status}`);
      updatedOrder = await order.save({ session });
    });
    return res.json({ success: true, order: updatedOrder });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL ORDER
// FIX H-1: Stock was previously restored for ALL items in non-shipped orders
// regardless of whether stock was actually deducted. This created a double-
// restore risk: if the expiry cron fired on the same order, stock would be
// added back twice.
//
// Fix: only restore stock when item.stockDeducted === true.
// The expiry cron (expireOrders.js) restores when stockReserved && !stockDeducted
// — these two conditions are mutually exclusive, so double-restoration is
// impossible once both sides honour the flags.
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelOrder = async (req, res) => {
  const { id }     = req.params;
  const { reason } = req.body;
  const session    = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, clientId: req.clientId }).session(session);
      if (!order) throw new Error('Order not found');

      // Only restore stock for items that are NOT yet shipped/delivered
      // AND where stock was actually deducted at order creation time.
      if (!['shipped', 'delivered', 'cancelled'].includes(order.fulfillment.status)) {
        for (const item of order.items) {
          // FIX H-1: guard on stockDeducted — expiry cron handles the reserved-only case
          if (item.stockDeducted === true) {
            await Product.findOneAndUpdate(
              { _id: item.product.id, clientId: req.clientId },
              { $inc: { stockQuantity: item.quantity } },
              { session }
            );
            // Mark as restored so any concurrent cleanup knows not to restore again
            item.stockDeducted  = false;
            item.stockReserved  = false;
          }
        }
      }

      await order.cancelOrder(reason, { session });
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET CUSTOMER ORDERS
// FIX M-4: The original code only checked req.user for ownership/admin status.
// Customers are attached to req.customer (not req.user) by the protect middleware,
// so every legitimate customer request received a 403. Now checks both.
// ─────────────────────────────────────────────────────────────────────────────
exports.getCustomerOrders = async (req, res) => {
  const email = req.params.email || req.query.email;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }

  // Allow: staff admin/owner, or the customer themselves (via req.customer)
  const isAdmin    = ['admin', 'owner'].includes(req.user?.role);
  // FIX M-4: customers land in req.customer, not req.user
  const isOwner    = req.user?.email === email || req.customer?.email === email;

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const orders = await Order.find({ 'customer.email': email, clientId: req.clientId })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve orders' });
  }
};
