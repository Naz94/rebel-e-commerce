const mongoose = require('mongoose');
const Order   = require('../models/Order');
const Client  = require('../models/Client');
const crypto  = require('crypto');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeVerifySignature = (secret, rawBody, signature) => {
  try {
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
};

// ─── Payment Method Discovery ─────────────────────────────────────────────────

exports.getPaymentMethods = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId }).lean();
    if (!client) return res.status(404).json({ success: false, message: 'Store not found' });

    const methods = [];

    // EFT is always available if banking details exist
    if (client.banking?.bankName) {
      methods.push({
        id: 'eft', label: 'EFT / Bank Transfer', icon: '🏦',
        description: 'Pay directly into our bank account.'
      });
    }

    // Paystack
    if (client.paystack?.publicKey) {
      methods.push({ id: 'paystack', label: 'Card / Instant EFT', icon: '💳', description: 'Pay securely via Paystack.' });
    }

    // Yoco
    if (client.yoco?.publicKey) {
      methods.push({ id: 'yoco', label: 'Credit / Debit Card', icon: '💳', description: 'Pay via Yoco.' });
    }

    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load payment methods' });
  }
};

// ─── EFT Initialiser (main payment path for most SA stores) ──────────────────

exports.initializeEftPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment.status === 'paid') return res.status(400).json({ success: false, message: 'Already paid' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();
    const b = client?.banking || {};

    res.json({
      success: true,
      data: {
        method:    'eft',
        orderNumber: order.orderNumber,
        amount:    order.totals.total,
        banking: {
          bankName:      b.bankName      || '',
          accountHolder: b.accountHolder || '',
          accountNumber: b.accountNumber || '',
          branchCode:    b.branchCode    || '',
          reference:     `${b.eftReferencePrefix || 'ORD'}-${order.orderNumber}`
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'EFT init failed' });
  }
};

// ─── Paystack ─────────────────────────────────────────────────────────────────

exports.initializePaystackPayment = async (req, res) => {
  try {
    const { orderId, email } = req.body;
    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();
    if (!client?.paystack?.secretKey) {
      return res.status(400).json({ success: false, message: 'Paystack not configured for this store' });
    }

    const axios = require('axios');
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email:     email || order.customer.email,
      amount:    Math.round(order.totals.total * 100), // Paystack uses kobo/cents
      reference: `${order.orderNumber}-${Date.now()}`,
      metadata:  { orderId: order._id.toString(), clientId: req.clientId }
    }, {
      headers: { Authorization: `Bearer ${client.paystack.secretKey}` }
    });

    res.json({ success: true, data: response.data.data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Paystack initialisation failed' });
  }
};

exports.verifyPaystackPayment = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId }).lean();
    if (!client?.paystack?.secretKey) return res.status(400).json({ success: false, message: 'Paystack not configured' });

    const axios = require('axios');
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.params.reference}`,
      { headers: { Authorization: `Bearer ${client.paystack.secretKey}` } }
    );

    const txn = response.data.data;
    if (txn.status === 'success') {
      const orderId = txn.metadata?.orderId;
      if (orderId) {
        const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
        if (order && order.payment.status !== 'paid') {
          await order.markAsPaid(txn.reference, order.totals.total, 'paystack');
        }
      }
      return res.json({ success: true, data: txn });
    }
    res.status(400).json({ success: false, message: 'Payment not successful' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  }
};

/**
 * handlePaystackWebhook
 * FIX 3: clientId read from DB order, NOT from payload metadata.
 * FIX 1: Signature verified using req.rawBody (set by captureRawBody in server.js).
 */
exports.handlePaystackWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const client = await Client.findOne({ clientId: req.headers['x-client-id'] }).lean();
    const secret = client?.paystack?.webhookSecret || process.env.PAYSTACK_WEBHOOK_SECRET;
    const signature = req.headers['x-paystack-signature'];

    if (!secret || !signature || !safeVerifySignature(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const payload = JSON.parse(req.rawBody.toString());
    if (payload.event === 'charge.success') {
      const orderId = payload.data?.metadata?.orderId;
      if (orderId) {
        await session.withTransaction(async () => {
          // FIX 3: bypassTenantFirewall — get clientId from DB, not payload
          const order = await Order.findById(orderId).session(session)
            .setOptions({ bypassTenantFirewall: true });
          if (order && order.payment.status !== 'paid') {
            await order.markAsPaid(payload.data.reference, order.totals.total, 'paystack', { session });
          }
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[PAYSTACK_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
};

// ─── Yoco ────────────────────────────────────────────────────────────────────

exports.initializeYocoPayment = async (req, res) => {
  res.status(501).json({ success: false, message: 'Yoco integration coming soon' });
};

exports.handleYocoWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

// ─── Ozow ─────────────────────────────────────────────────────────────────────

exports.initializeOzowPayment = async (req, res) => {
  res.status(501).json({ success: false, message: 'Ozow integration coming soon' });
};

exports.handleOzowWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

// ─── SnapScan ─────────────────────────────────────────────────────────────────

exports.initializeSnapScanPayment = async (req, res) => {
  res.status(501).json({ success: false, message: 'SnapScan integration coming soon' });
};

exports.handleSnapScanWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

// ─── Zapper ──────────────────────────────────────────────────────────────────

exports.initializeZapperPayment = async (req, res) => {
  res.status(501).json({ success: false, message: 'Zapper integration coming soon' });
};

exports.handleZapperWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

// ─── Admin Actions ─────────────────────────────────────────────────────────────

exports.markOrderAsPaid = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let paidOrder;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: req.params.orderId, clientId: req.clientId }).session(session);
      if (!order) throw new Error('Order not found');
      paidOrder = await order.markAsPaid(
        req.body.transactionId || `MANUAL-${Date.now()}`,
        order.totals.total,
        req.body.provider || 'manual',
        { session }
      );
    });
    res.json({ success: true, data: paidOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.processRefund = async (req, res) => {
  res.status(501).json({ success: false, message: 'Refund processing coming soon' });
};
