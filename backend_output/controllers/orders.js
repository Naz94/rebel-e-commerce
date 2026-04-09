const mongoose = require('mongoose');
const Order    = require('../models/Order');
const Product  = require('../models/Product');
const Customer = require('../models/Customer');
const {
  VAT_RATE,
  MAX_CART_LINE_ITEMS,
  MAX_QUANTITY_PER_ITEM
} = require('../constants/order');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validateOrderInput = (body) => {
  if (!body.customer?.email || !validateEmail(body.customer.email)) return 'Valid customer email required';
  if (!Array.isArray(body.items) || !body.items.length)             return 'Order items cannot be empty';
  if (body.items.length > MAX_CART_LINE_ITEMS)                      return 'Order exceeds line item limit';
  for (const item of body.items) {
    if (!item.product?.id)                                          return 'Product ID is required for all items';
    if (!Number.isInteger(item.quantity) || item.quantity < 1)      return 'Invalid quantity';
    if (item.quantity > MAX_QUANTITY_PER_ITEM)                      return 'Per-item quantity limit exceeded';
  }
  return null;
};

// ─── Controllers ─────────────────────────────────────────────────────────────

exports.getAllOrders = async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page)  || 1,   1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip  = (page - 1) * limit;

    const filter = { clientId: req.clientId };
    if (req.query.days) {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(req.query.days));
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

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, clientId: req.clientId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error retrieving order' });
  }
};

/**
 * createOrder — atomic stock deduction + order creation.
 * Normalises the frontend payload shape before processing.
 */
exports.createOrder = async (req, res) => {
  // ── Normalise frontend payload ──────────────────────────────────────────
  const body = req.body;

  // customer object
  if (!body.customer && (body.email || body.customerName)) {
    body.customer = {
      name:  body.customerName || '',
      email: body.email        || '',
      phone: body.phone        || ''
    };
  }

  // items: frontend may send [{ productId, quantity }]
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
      let subtotalExcl = 0;

      for (const item of items) {
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

        const itemTotal = product.price * item.quantity;
        subtotalExcl += itemTotal;

        processedItems.push({
          product:         { id: product._id, name: product.name, sku: product.sku },
          quantity:        item.quantity,
          priceAtPurchase: product.price,
          subtotal:        parseFloat(itemTotal.toFixed(2)),
          stockReserved:   true,
          stockDeducted:   true
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
        clientId:     req.clientId,
        customer,
        items:        processedItems,
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
      if (eftDetails) {
        finalOrder.eftDetails.reference = `${req.client.banking.eftReferencePrefix || 'ORD'}-${finalOrder.orderNumber}`;
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

    // Update customer lifetime stats — non-critical, outside transaction
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

exports.getSalesStats = async (req, res) => {
  try {
    const matchExtra = {};
    if (req.query.days) {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(req.query.days));
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

exports.updateFulfillment = async (req, res) => {
  const { id } = req.params;
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

exports.cancelOrder = async (req, res) => {
  const { id }     = req.params;
  const { reason } = req.body;
  const session    = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: id, clientId: req.clientId }).session(session);
      if (!order) throw new Error('Order not found');

      if (!['shipped', 'delivered', 'cancelled'].includes(order.fulfillment.status)) {
        for (const item of order.items) {
          await Product.findOneAndUpdate(
            { _id: item.product.id, clientId: req.clientId },
            { $inc: { stockQuantity: item.quantity } },
            { session }
          );
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

/**
 * getCustomerOrders
 * FIX: route is GET /orders/customer/:email — email comes from req.params, not req.query.
 * The old code read req.query.email which is always undefined for this route shape.
 */
exports.getCustomerOrders = async (req, res) => {
  // Accept email from params (route: /customer/:email) OR query (?email=) for flexibility
  const email = req.params.email || req.query.email;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }

  const isOwner = req.user?.email === email;
  const isAdmin = ['admin', 'owner'].includes(req.user?.role);
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
