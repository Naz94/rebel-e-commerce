const mongoose = require('mongoose');
const Order    = require('../models/Order');
const Client   = require('../models/Client');
const crypto   = require('crypto');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
 * resolveOrderPayment — looks up an order by ID (bypassing tenant firewall for
 * webhook context where clientId isn't in the request headers) and calls markAsPaid.
 */
const resolveOrderPayment = async (orderId, transactionId, provider, session) => {
  const order = await Order.findById(orderId)
    .session(session)
    .setOptions({ bypassTenantFirewall: true });

  if (order && order.payment.status !== 'paid') {
    await order.markAsPaid(transactionId, order.totals.total, provider, { session });
  }
};

// ─── Payment Method Discovery ─────────────────────────────────────────────────

exports.getPaymentMethods = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId }).lean();
    if (!client) return res.status(404).json({ success: false, message: 'Store not found' });

    const methods = [];

    // EFT — always available when banking details are configured
    if (client.banking?.bankName) {
      methods.push({
        id:          'eft',
        label:       'EFT / Bank Transfer',
        icon:        '🏦',
        description: 'Pay directly into our bank account.'
      });
    }

    // FIX: correct path is client.paymentGateways.paystack (not client.paystack)
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

// ─── EFT Initialiser ──────────────────────────────────────────────────────────

exports.initializeEftPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Already paid' });
    }

    const client = await Client.findOne({ clientId: req.clientId }).lean();
    const b = client?.banking || {};

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

// ─── Paystack ─────────────────────────────────────────────────────────────────

exports.initializePaystackPayment = async (req, res) => {
  try {
    const { orderId, email } = req.body;
    const order = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // FIX: correct schema path — client.paymentGateways.paystack (not client.paystack)
    const client = await Client.findOne({ clientId: req.clientId })
      .select('+paymentGateways.paystack.secretKey')
      .lean();

    if (!client?.paymentGateways?.paystack?.secretKey) {
      return res.status(400).json({ success: false, message: 'Paystack not configured for this store' });
    }

    const axios = require('axios');
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email:     email || order.customer.email,
        amount:    Math.round(order.totals.total * 100), // Paystack expects kobo/cents
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

exports.verifyPaystackPayment = async (req, res) => {
  try {
    // FIX: correct schema path
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
 * - Verifies HMAC-SHA512 signature using raw body buffer
 * - Reads clientId from the DB order (not from untrusted payload metadata)
 */
exports.handlePaystackWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // Try per-client secret first, fall back to global env secret
    const clientHeader = req.headers['x-client-id'];
    let secret = process.env.PAYSTACK_WEBHOOK_SECRET;
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

// ─── Yoco ────────────────────────────────────────────────────────────────────

exports.initializeYocoPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order  = await Order.findOne({ _id: orderId, clientId: req.clientId });
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
        amount:    Math.round(order.totals.total * 100), // Yoco uses cents
        currency:  'ZAR',
        metadata:  { orderId: order._id.toString(), clientId: req.clientId }
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
 * handleYocoWebhook
 * Yoco sends HMAC-SHA256 in the x-yoco-signature header.
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

    // Yoco event: payment.succeeded
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
    const order  = await Order.findOne({ _id: orderId, clientId: req.clientId });
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

    // Build hash: siteCode + countryCode + currencyCode + amount + transactionRef + optional1..5 + cancelUrl + errorUrl + successUrl + notifyUrl + isTest + privateKey
    // For simplicity we expose the redirect URLs so the frontend can redirect
    const hashInput = `${siteCode}ZAR${amount}${reference}${orderId}${isTest ? 'true' : 'false'}${privateKey}`.toLowerCase();
    const hashCheck = crypto.createHash('sha512').update(hashInput).digest('hex');

    res.json({
      success: true,
      data: {
        siteCode,
        countryCode:  'ZA',
        currencyCode: 'ZAR',
        amount,
        transactionReference: reference,
        optional1:    orderId,
        isTest:       isTest ? 'true' : 'false',
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
 * Ozow sends fields as form-body; signature is a SHA-512 hash of concatenated fields + private key.
 * FIX: was a silent stub — now verifies and processes the payment.
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

    // Look up this store's Ozow private key by siteCode
    const client = await Client.findOne({ 'paymentGateways.ozow.siteCode': SiteCode })
      .select('+paymentGateways.ozow.privateKey')
      .lean();

    if (!client) return res.status(401).send('Unauthorized');

    const privateKey = client.paymentGateways.ozow.privateKey;

    // Ozow hash: concatenate specific fields (lowercase) + privateKey (lowercase)
    // Fields: TransactionId, TransactionReference, CurrencyCode, Amount, Status, Optional1..5 (if present)
    const hashFields = [TransactionId, TransactionReference, CurrencyCode, Amount, Status];
    // Append optional fields if they exist and are defined (even "0" is valid)
    ['Optional1','Optional2','Optional3','Optional4','Optional5'].forEach(f => {
      if (body[f] !== undefined && body[f] !== null) hashFields.push(body[f]);
    });
    const hashInput  = hashFields.join('').toLowerCase() + privateKey.toLowerCase();
    const computed   = crypto.createHash('sha512').update(hashInput).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(CheckSum.toLowerCase()))) {
      return res.status(401).send('Unauthorized');
    }

    if (Status === 'Complete') {
      // Optional1 carries orderId set during initialization
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
    const order  = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();

    if (!client?.paymentGateways?.snapscan?.snapCode) {
      return res.status(400).json({ success: false, message: 'SnapScan not configured for this store' });
    }

    const { snapCode } = client.paymentGateways.snapscan;
    const amount       = Math.round(order.totals.total * 100); // SnapScan uses cents

    // SnapScan deep-link QR URL format
    const snapUrl = `https://pos.snapscan.io/qr/${snapCode}?id=${order.orderNumber}&amount=${amount}`;

    res.json({
      success: true,
      data: {
        snapUrl,
        orderNumber: order.orderNumber,
        amount:      order.totals.total
      }
    });
  } catch (error) {
    console.error('[SNAPSCAN_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'SnapScan initialisation failed' });
  }
};

/**
 * handleSnapScanWebhook
 * SnapScan sends a JSON body (as application/x-www-form-urlencoded with a 'payload' field).
 * FIX: was a silent stub — now verifies auth header and processes.
 */
exports.handleSnapScanWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // SnapScan uses HTTP Basic Auth on the webhook URL (set in SnapScan merchant portal)
    const authHeader = req.headers['authorization'] || '';
    const base64     = authHeader.startsWith('Basic ') ? authHeader.slice(6) : '';
    const [,webhookPassword] = Buffer.from(base64, 'base64').toString().split(':');

    // The raw body is form-encoded: payload=<JSON string>
    const rawStr = req.rawBody ? req.rawBody.toString() : '';
    const params = new URLSearchParams(rawStr);
    const jsonStr = params.get('payload') || rawStr;
    let payload;
    try { payload = JSON.parse(jsonStr); } catch { return res.status(400).send('Bad Request'); }

    // Look up client by snapCode embedded in the webhook callback URL (or via merchantReference)
    const merchantRef = payload.merchantReference || payload.id;
    // Find the order to get the clientId
    const order = await Order.findOne({ orderNumber: merchantRef })
      .setOptions({ bypassTenantFirewall: true });

    if (order) {
      const client = await Client.findOne({ clientId: order.clientId })
        .select('+paymentGateways.snapscan.webhookAuthKey')
        .lean();

      const expectedKey = client?.paymentGateways?.snapscan?.webhookAuthKey
        || process.env.SNAPSCAN_WEBHOOK_AUTH_KEY;

      if (expectedKey && webhookPassword !== expectedKey) {
        return res.status(401).send('Unauthorized');
      }

      if (payload.status === 'completed' && order.payment.status !== 'paid') {
        await session.withTransaction(async () => {
          await resolveOrderPayment(order._id.toString(), payload.id, 'snapscan', session);
        });
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[SNAPSCAN_WEBHOOK]:', error.message);
    res.status(500).send('Error');
  } finally {
    await session.endSession();
  }
};

// ─── Zapper ──────────────────────────────────────────────────────────────────

exports.initializeZapperPayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order  = await Order.findOne({ _id: orderId, clientId: req.clientId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const client = await Client.findOne({ clientId: req.clientId }).lean();

    if (!client?.paymentGateways?.zapper?.merchantId) {
      return res.status(400).json({ success: false, message: 'Zapper not configured for this store' });
    }

    const { merchantId, siteId } = client.paymentGateways.zapper;
    const amount = order.totals.total.toFixed(2);

    // Zapper QR deep-link
    const zapperUrl = `https://zapper.com/pay?merchantId=${merchantId}&siteId=${siteId}&amount=${amount}&reference=${order.orderNumber}`;

    res.json({
      success: true,
      data: {
        zapperUrl,
        orderNumber: order.orderNumber,
        amount:      order.totals.total
      }
    });
  } catch (error) {
    console.error('[ZAPPER_INIT]:', error.message);
    res.status(500).json({ success: false, message: 'Zapper initialisation failed' });
  }
};

/**
 * handleZapperWebhook
 * Zapper sends HMAC-SHA256 in the x-zapper-signature header.
 * FIX: was a silent stub — now verifies and processes.
 */
exports.handleZapperWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // Try per-client key first, then global env
    let secret = process.env.ZAPPER_WEBHOOK_SECRET;
    const payload   = JSON.parse(req.rawBody.toString());
    const reference = payload?.data?.reference || payload?.reference;

    if (reference) {
      // reference is the orderNumber — use it to find the client
      const order = await Order.findOne({ orderNumber: reference })
        .setOptions({ bypassTenantFirewall: true });
      if (order) {
        const client = await Client.findOne({ clientId: order.clientId })
          .select('+paymentGateways.zapper.apiKey')
          .lean();
        secret = client?.paymentGateways?.zapper?.apiKey || secret;
      }
    }

    const signature = req.headers['x-zapper-signature'];
    if (!secret || !signature || !safeVerifySignature256(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

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
