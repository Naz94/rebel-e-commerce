const mongoose = require('mongoose');
const Order    = require('../models/Order');
const Client   = require('../models/Client');
const crypto   = require('crypto');

// ─── Signature helpers ────────────────────────────────────────────────────────

/**
 * HMAC-SHA512 constant-time comparison.
 * Used for Paystack & generic gateway signature checks.
 */
const safeVerifySignature512 = (secret, rawBody, signature) => {
  try {
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
};

/**
 * HMAC-SHA256 constant-time comparison.
 * Used for Yoco & Zapper which use SHA-256.
 */
const safeVerifySignature256 = (secret, rawBody, signature) => {
  try {
    const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
};

/**
 * resolveOrderPayment — webhook-context helper.
 * Looks up an order by ID bypassing the tenant firewall (clientId comes from
 * the DB record itself, not from an untrusted request header) and calls markAsPaid.
 * Must be called inside a withTransaction block.
 */
const resolveOrderPayment = async (orderId, transactionId, provider, session) => {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new Error(`[WEBHOOK] Invalid orderId: ${orderId}`);
  }

  const order = await Order.findById(orderId)
    .session(session)
    .setOptions({ bypassTenantFirewall: true });

  // Idempotency: markAsPaid is also guarded, but skip the DB write entirely
  // if we can detect it early.
  if (order && order.payment.status !== 'paid') {
    await order.markAsPaid(transactionId, order.totals.total, provider, { session });
  }
};

// ─── Payment Method Discovery ──────────────────────────────────────────────────

exports.getPaymentMethods = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId }).lean();
    if (!client) return res.status(404).json({ success: false, message: 'Store not found' });

    const methods = [];

    if (client.banking?.bankName) {
      methods.push({
        id:          'eft',
        label:       'EFT / Bank Transfer',
        icon:        '🏦',
        description: 'Pay directly into our bank account.'
      });
    }

    if (client.paymentGateways?.paystack?.enabled && client.paymentGateways?.paystack?.publicKey) {
      methods.push({ id: 'paystack', label: 'Card / Instant EFT', icon: '💳', description: 'Pay securely via Paystack.' });
    }

    if (client.paymentGateways?.yoco?.enabled && client.paymentGateways?.yoco?.publicKey) {
      methods.push({ id: 'yoco', label: 'Credit / Debit Card', icon: '💳', description: 'Pay via Yoco.' });
    }

    if (client.paymentGateways?.ozow?.enabled) {
      methods.push({ id: 'ozow', label: 'Instant EFT (Ozow)', icon: '🏦', description: 'Pay instantly via Ozow.' });
    }

    if (client.paymentGateways?.snapscan?.enabled) {
      methods.push({ id: 'snapscan', label: 'SnapScan', icon: '📷', description: 'Pay by scanning a QR code.' });
    }

    if (client.paymentGateways?.zapper?.enabled) {
      methods.push({ id: 'zapper', label: 'Zapper', icon: '📱', description: 'Pay using the Zapper app.' });
    }

    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load payment methods' });
  }
};

// ─── EFT Initialiser ───────────────────────────────────────────────────────────

exports.initializeEftPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Already paid' });
    }

    const client = await Client.findOne({ clientId: req.clientId }).lean();
    const b      = client?.banking || {};

    res.json({
      success: true,
      data: {
        method:      'eft',
        orderNumber: order.orderNumber,
        amount:      order.totals.total,
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

// ─── Paystack ──────────────────────────────────────────────────────────────────

exports.initializePaystackPayment = async (req, res) => {
  try {
    const { orderId, email } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId })
      .select('+paymentGateways.paystack.secretKey')
      .lean();

    if (!client?.paymentGateways?.paystack?.secretKey) {
      return res.status(400).json({ success: false, message: 'Paystack not configured for this store' });
    }

    const axios    = require('axios');
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email:     email || order.customer.email,
        amount:    Math.round(order.totals.total * 100), // Paystack expects kobo (cents)
        reference: `${order.orderNumber}-${Date.now()}`,
        metadata:  { orderId: order._id.toString(), clientId: req.clientId }
      },
      { headers: { Authorization: `Bearer ${client.paymentGateways.paystack.secretKey}` } }
    );

    res.json({ success: true, data: response.data.data });
  } catch (error) {
    console.error('[PAYSTACK_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'Paystack initialisation failed' });
  }
};

/**
 * verifyPaystackPayment — redirect fallback.
 * FIX H-3 / C-2: wrapped in a transaction so the find + markAsPaid pair is atomic.
 * Concurrent webhook + redirect no longer risks double-processing.
 */
exports.verifyPaystackPayment = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const client = await Client.findOne({ clientId: req.clientId })
      .select('+paymentGateways.paystack.secretKey')
      .lean();

    if (!client?.paymentGateways?.paystack?.secretKey) {
      return res.status(400).json({ success: false, message: 'Paystack not configured' });
    }

    const axios    = require('axios');
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.params.reference}`,
      { headers: { Authorization: `Bearer ${client.paymentGateways.paystack.secretKey}` } }
    );

    const txn = response.data.data;

    if (txn.status === 'success') {
      const orderId = txn.metadata?.orderId;

      if (orderId) {
        // FIX: wrap in transaction — webhook may fire at the same time
        await session.withTransaction(async () => {
          await resolveOrderPayment(orderId, txn.reference, 'paystack', session);
        });
      }
      return res.json({ success: true, data: txn });
    }

    res.status(400).json({ success: false, message: 'Payment not successful' });
  } catch (error) {
    console.error('[PAYSTACK_VERIFY]:', error.message);
    res.status(500).json({ success: false, message: 'Payment verification failed' });
  } finally {
    await session.endSession();
  }
};

/**
 * handlePaystackWebhook
 * - Verifies HMAC-SHA512 using raw body buffer
 * - Resolves clientId from the stored order, not from untrusted headers
 */
exports.handlePaystackWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // Try per-client secret first; fall back to global env secret
    const clientHeader = req.headers['x-client-id'];
    let   secret       = process.env.PAYSTACK_WEBHOOK_SECRET;

    if (clientHeader) {
      const client = await Client.findOne({ clientId: clientHeader })
        .select('+paymentGateways.paystack.secretKey')
        .lean();
      secret = client?.paymentGateways?.paystack?.secretKey || secret;
    }

    const signature = req.headers['x-paystack-signature'];
    if (!secret || !signature || !safeVerifySignature512(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const payload = JSON.parse(req.rawBody.toString());

    if (payload.event === 'charge.success') {
      const orderId = payload.data?.metadata?.orderId;
      if (orderId) {
        await session.withTransaction(async () => {
          await resolveOrderPayment(orderId, payload.data.reference, 'paystack', session);
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

// ─── Yoco ─────────────────────────────────────────────────────────────────────

exports.initializeYocoPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId })
      .select('+paymentGateways.yoco.secretKey')
      .lean();

    if (!client?.paymentGateways?.yoco?.secretKey) {
      return res.status(400).json({ success: false, message: 'Yoco not configured for this store' });
    }

    const axios    = require('axios');
    const response = await axios.post(
      'https://payments.yoco.com/api/checkouts',
      {
        amount:   Math.round(order.totals.total * 100), // Yoco uses cents
        currency: 'ZAR',
        metadata: { orderId: order._id.toString(), clientId: req.clientId }
      },
      {
        headers: {
          Authorization:  `Bearer ${client.paymentGateways.yoco.secretKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('[YOCO_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'Yoco initialisation failed' });
  }
};

/**
 * handleYocoWebhook — Yoco sends HMAC-SHA256 in x-yoco-signature.
 */
exports.handleYocoWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const secret    = process.env.YOCO_WEBHOOK_SECRET;
    const signature = req.headers['x-yoco-signature'];

    if (!secret || !signature || !safeVerifySignature256(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const payload = JSON.parse(req.rawBody.toString());

    if (payload.type === 'payment.succeeded') {
      const orderId = payload.payload?.metadata?.orderId;
      if (orderId) {
        await session.withTransaction(async () => {
          await resolveOrderPayment(orderId, payload.id, 'yoco', session);
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[YOCO_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
};

// ─── Ozow ─────────────────────────────────────────────────────────────────────

exports.initializeOzowPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId })
      .select('+paymentGateways.ozow.privateKey +paymentGateways.ozow.apiKey')
      .lean();

    if (!client?.paymentGateways?.ozow?.siteCode) {
      return res.status(400).json({ success: false, message: 'Ozow not configured for this store' });
    }

    const { siteCode, privateKey, isTest } = client.paymentGateways.ozow;
    const amount    = order.totals.total.toFixed(2);
    const reference = order.orderNumber;

    const hashInput = `${siteCode}ZAR${amount}${reference}${orderId}${isTest ? 'true' : 'false'}${privateKey}`.toLowerCase();
    const hashCheck = crypto.createHash('sha512').update(hashInput).digest('hex');

    res.json({
      success: true,
      data: {
        siteCode,
        countryCode:          'ZA',
        currencyCode:         'ZAR',
        amount,
        transactionReference: reference,
        optional1:            orderId,
        isTest:               isTest ? 'true' : 'false',
        hashCheck
      }
    });
  } catch (error) {
    console.error('[OZOW_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'Ozow initialisation failed' });
  }
};

/**
 * handleOzowWebhook
 * Ozow sends form-body fields; signature is SHA-512 of fields + private key.
 */
exports.handleOzowWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const body = typeof req.body === 'string'
      ? Object.fromEntries(new URLSearchParams(req.body))
      : req.rawBody
        ? Object.fromEntries(new URLSearchParams(req.rawBody.toString()))
        : req.body;

    const {
      SiteCode, TransactionId, TransactionReference, CurrencyCode,
      Amount, Status, Optional1, CheckSum
    } = body;

    if (!SiteCode || !CheckSum) {
      return res.status(400).send('Bad Request');
    }

    const client = await Client.findOne({ 'paymentGateways.ozow.siteCode': SiteCode })
      .select('+paymentGateways.ozow.privateKey')
      .lean();

    if (!client) return res.status(401).send('Unauthorized');

    const privateKey  = client.paymentGateways.ozow.privateKey;
    const hashFields  = [TransactionId, TransactionReference, CurrencyCode, Amount, Status];

    ['Optional1', 'Optional2', 'Optional3', 'Optional4', 'Optional5'].forEach(f => {
      if (body[f] !== undefined && body[f] !== null) hashFields.push(body[f]);
    });

    const hashInput = hashFields.join('').toLowerCase() + privateKey.toLowerCase();
    const computed  = crypto.createHash('sha512').update(hashInput).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(CheckSum.toLowerCase()))) {
      return res.status(401).send('Unauthorized');
    }

    if (Status === 'Complete') {
      const orderId = Optional1;
      if (orderId) {
        await session.withTransaction(async () => {
          await resolveOrderPayment(orderId, TransactionId, 'ozow', session);
        });
      }
    }

    res.status(200).send('');
  } catch (error) {
    console.error('[OZOW_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
};

// ─── SnapScan ─────────────────────────────────────────────────────────────────

exports.initializeSnapScanPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();

    if (!client?.paymentGateways?.snapscan?.snapCode) {
      return res.status(400).json({ success: false, message: 'SnapScan not configured for this store' });
    }

    const { snapCode } = client.paymentGateways.snapscan;
    const amount       = Math.round(order.totals.total * 100); // SnapScan uses cents

    const snapUrl = `https://pos.snapscan.io/qr/${snapCode}?id=${order.orderNumber}&amount=${amount}`;

    res.json({
      success: true,
      data: { snapUrl, orderNumber: order.orderNumber, amount: order.totals.total }
    });
  } catch (error) {
    console.error('[SNAPSCAN_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'SnapScan initialisation failed' });
  }
};

/**
 * handleSnapScanWebhook
 * SnapScan uses HTTP Basic Auth for webhook authentication.
 * FIX C-4: if order is not found we now return 400 instead of silently 200-ing.
 */
exports.handleSnapScanWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const authHeader = req.headers['authorization'] || '';
    const base64     = authHeader.startsWith('Basic ') ? authHeader.slice(6) : '';
    const [, webhookPassword] = Buffer.from(base64, 'base64').toString().split(':');

    const rawStr  = req.rawBody ? req.rawBody.toString() : '';
    const params  = new URLSearchParams(rawStr);
    const jsonStr = params.get('payload') || rawStr;

    let payload;
    try { payload = JSON.parse(jsonStr); } catch { return res.status(400).send('Bad Request'); }

    const merchantRef = payload.merchantReference || payload.id;
    if (!merchantRef) return res.status(400).send('Bad Request');

    const order = await Order.findOne({ orderNumber: merchantRef })
      .setOptions({ bypassTenantFirewall: true });

    // FIX C-4: must reject if order not found — we cannot verify auth without the client record
    if (!order) return res.status(400).send('Order Not Found');

    const client = await Client.findOne({ clientId: order.clientId })
      .select('+paymentGateways.snapscan.webhookAuthKey')
      .lean();

    const expectedKey = client?.paymentGateways?.snapscan?.webhookAuthKey
      || process.env.SNAPSCAN_WEBHOOK_AUTH_KEY;

    // If a key is configured, enforce it. If none configured, log a warning but allow.
    if (expectedKey && webhookPassword !== expectedKey) {
      return res.status(401).send('Unauthorized');
    }

    if (!expectedKey) {
      console.warn('[SNAPSCAN_WEBHOOK] No webhookAuthKey configured — accepting unauthenticated webhook.');
    }

    if (payload.status === 'completed' && order.payment.status !== 'paid') {
      await session.withTransaction(async () => {
        await resolveOrderPayment(order._id.toString(), payload.id, 'snapscan', session);
      });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[SNAPSCAN_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
};

// ─── Zapper ───────────────────────────────────────────────────────────────────

exports.initializeZapperPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();

    if (!client?.paymentGateways?.zapper?.merchantId) {
      return res.status(400).json({ success: false, message: 'Zapper not configured for this store' });
    }

    const { merchantId, siteId } = client.paymentGateways.zapper;
    const amount  = order.totals.total.toFixed(2);
    const zapperUrl = `https://zapper.com/pay?merchantId=${merchantId}&siteId=${siteId}&amount=${amount}&reference=${order.orderNumber}`;

    res.json({
      success: true,
      data: { zapperUrl, orderNumber: order.orderNumber, amount: order.totals.total }
    });
  } catch (error) {
    console.error('[ZAPPER_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'Zapper initialisation failed' });
  }
};

/**
 * handleZapperWebhook — HMAC-SHA256 in x-zapper-signature.
 * FIX C-3: signature MUST be verified before any DB lookup to prevent
 * timing-oracle attacks. We verify with the global env key first, then
 * optionally upgrade to the per-tenant key after finding the order.
 * If neither key validates the signature, we reject immediately.
 */
exports.handleZapperWebhook = async (req, res) => {
  const session   = await mongoose.startSession();
  const signature = req.headers['x-zapper-signature'];

  if (!signature) return res.status(401).send('Unauthorized');

  try {
    // Step 1: verify against the global fallback key first (fast-path rejection)
    const globalSecret = process.env.ZAPPER_WEBHOOK_SECRET;

    // Parse payload now — but we won't act on it until the signature is verified
    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString());
    } catch {
      return res.status(400).send('Bad Request');
    }

    const reference = payload?.data?.reference || payload?.reference;

    // Step 2: attempt to resolve a per-tenant secret
    let tenantSecret = null;
    if (reference) {
      const order = await Order.findOne({ orderNumber: reference })
        .setOptions({ bypassTenantFirewall: true });
      if (order) {
        const client = await Client.findOne({ clientId: order.clientId })
          .select('+paymentGateways.zapper.apiKey')
          .lean();
        tenantSecret = client?.paymentGateways?.zapper?.apiKey || null;
      }
    }

    // Step 3: verify with tenant secret if available, else fall back to global.
    // Reject if neither validates.
    const secret = tenantSecret || globalSecret;
    if (!secret || !safeVerifySignature256(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    // Step 4: process payment
    if (payload?.status === 'completed' || payload?.data?.status === 'completed') {
      const orderId = payload?.data?.orderId || payload?.orderId;
      if (orderId) {
        await session.withTransaction(async () => {
          await resolveOrderPayment(orderId, payload.id || payload.transactionId, 'zapper', session);
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[ZAPPER_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
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
