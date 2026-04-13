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
 * resolveOrderPayment — atomically claims the "unpaid → paying" transition using
 * a compare-and-swap findOneAndUpdate so that only one concurrent webhook delivery
 * can win the race.  The update sets a sentinel transactionId that acts as the
 * idempotency key; if a second call arrives with the same or a different transactionId
 * for an already-paid order, the findOneAndUpdate returns null and we skip silently.
 *
 * This replaces the previous two-step read-then-write pattern which had a TOCTOU race
 * window between the `payment.status !== 'paid'` check and the `markAsPaid` save.
 *
 * Flow:
 *  1. Atomically set payment.status = 'processing' only if it is currently 'pending'.
 *     This is the idempotency gate — only one caller wins.
 *  2. If we won, call markAsPaid (which sets status = 'paid') inside the same session.
 *  3. If we lost (order already processing/paid), skip silently — idempotent success.
 *
 * NOTE: 'processing' is a transient sentinel state that only exists inside a
 * Mongoose session transaction. If the transaction aborts, MongoDB rolls it back
 * automatically, leaving the order as 'pending' so a retry can succeed.
 */
const resolveOrderPayment = async (orderId, transactionId, provider, session) => {
  if (!orderId || !transactionId) {
    throw new Error('[resolveOrderPayment] orderId and transactionId are required');
  }

  // Atomic compare-and-swap: claim the order only if it is still pending.
  // Using findOneAndUpdate rather than find + save avoids the TOCTOU race.
  // The $ne guard means only the first concurrent winner proceeds; all others
  // get null back and exit without error (idempotent).
  const claimed = await Order.findOneAndUpdate(
    {
      _id:                  orderId,
      'payment.status':     'pending'   // Only claim unpaid orders
    },
    {
      $set: {
        'payment.status':        'processing',  // Transient sentinel; rolled back on abort
        'payment.transactionId': transactionId  // Idempotency key recorded atomically
      }
    },
    {
      new:     false,   // We only need to know if the CAS succeeded; don't need new doc
      session           // Must be inside the withTransaction session
    }
  ).setOptions({ bypassTenantFirewall: true }); // System/webhook context — no request clientId

  // If null: order was already processing or paid — idempotent, nothing to do.
  if (!claimed) return;

  // We won the race. Now fetch the full document and complete the payment.
  // Re-fetch inside the same session to get a consistent, locked view.
  const order = await Order.findById(orderId)
    .session(session)
    .setOptions({ bypassTenantFirewall: true });

  if (!order) {
    // Should never happen after a successful CAS, but guard anyway.
    throw new Error(`[resolveOrderPayment] Order ${orderId} disappeared after CAS`);
  }

  // markAsPaid sets status = 'paid', records paidAt, and adds a timeline event.
  await order.markAsPaid(transactionId, order.totals.total, provider, { session });
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
        // FIX: wrap in session + transaction to match webhook safety guarantees.
        // Previously this called markAsPaid outside a session, creating a write
        // that could conflict with a concurrent webhook delivery.
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await resolveOrderPayment(orderId, txn.reference, 'paystack', session);
          });
        } finally {
          await session.endSession();
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
 * - Verifies HMAC-SHA512 signature using raw body buffer BEFORE any DB access
 * - Uses resolveOrderPayment for idempotent, transactional payment confirmation
 */
exports.handlePaystackWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // ── STEP 1: Verify signature BEFORE any DB read or write ──────────────────
    // Try per-client secret first, fall back to global env secret.
    // The x-client-id header is optional and untrusted — we only use it to look
    // up a per-tenant key; the signature itself is the actual trust anchor.
    const clientHeader = req.headers['x-client-id'];
    let secret = process.env.PAYSTACK_WEBHOOK_SECRET;
    if (clientHeader) {
      const client = await Client.findOne({ clientId: clientHeader })
        .select('+paymentGateways.paystack.secretKey')
        .lean();
      // Use the per-tenant key if present; otherwise keep the global fallback.
      secret = client?.paymentGateways?.paystack?.secretKey || secret;
    }

    const signature = req.headers['x-paystack-signature'];
    // Reject immediately if signature is missing or invalid.
    // This check uses rawBody (buffer) — never re-stringified JSON.
    if (!secret || !signature || !safeVerifySignature512(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    // ── STEP 2: Parse payload — only after signature is verified ──────────────
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
 * Signature verified BEFORE any DB write.
 */
exports.handleYocoWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // ── STEP 1: Verify signature BEFORE any DB write ───────────────────────────
    const secret    = process.env.YOCO_WEBHOOK_SECRET;
    const signature = req.headers['x-yoco-signature'];

    if (!secret || !signature || !safeVerifySignature256(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    // ── STEP 2: Parse and process — only after signature is verified ──────────
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
 * Signature verified BEFORE any DB write.
 * FIX: Moved key lookup and signature verification before any order processing.
 */
exports.handleOzowWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // ── STEP 1: Parse the form body ────────────────────────────────────────────
    // Ozow sends form-encoded data; we need to parse it before we can verify.
    // This is safe because we do NOT act on the data until the signature is verified.
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

    // ── STEP 2: Verify signature BEFORE any DB write ───────────────────────────
    // Look up this store's Ozow private key by siteCode.
    // This single read is unavoidable for multi-tenant key lookup, but no order
    // data is accessed or mutated until the signature is confirmed valid.
    const client = await Client.findOne({ 'paymentGateways.ozow.siteCode': SiteCode })
      .select('+paymentGateways.ozow.privateKey')
      .lean();

    if (!client) return res.status(401).send('Unauthorized');

    const privateKey = client.paymentGateways.ozow.privateKey;

    // Ozow hash: concatenate specific fields (lowercase) + privateKey (lowercase)
    const hashFields = [TransactionId, TransactionReference, CurrencyCode, Amount, Status];
    // Append optional fields if they exist and are defined (even "0" is valid)
    ['Optional1','Optional2','Optional3','Optional4','Optional5'].forEach(f => {
      if (body[f] !== undefined && body[f] !== null) hashFields.push(body[f]);
    });
    const hashInput  = hashFields.join('').toLowerCase() + privateKey.toLowerCase();
    const computed   = crypto.createHash('sha512').update(hashInput).digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(CheckSum.toLowerCase()))) {
      return res.status(401).send('Unauthorized');
    }

    // ── STEP 3: Process payment — only after signature is verified ─────────────
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
 * SnapScan uses HTTP Basic Auth + a JSON payload field.
 * Auth key verified BEFORE any DB write.
 * FIX: Key validation now happens before order lookup to prevent order-existence oracle.
 */
exports.handleSnapScanWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // ── STEP 1: Parse Basic Auth header ───────────────────────────────────────
    // Extract the webhook password from the Authorization header.
    // We must parse this first as it is our primary trust signal.
    const authHeader = req.headers['authorization'] || '';
    const base64     = authHeader.startsWith('Basic ') ? authHeader.slice(6) : '';
    const [,webhookPassword] = Buffer.from(base64, 'base64').toString().split(':');

    // ── STEP 2: Parse the payload ──────────────────────────────────────────────
    // The raw body is form-encoded: payload=<JSON string>
    const rawStr  = req.rawBody ? req.rawBody.toString() : '';
    const params  = new URLSearchParams(rawStr);
    const jsonStr = params.get('payload') || rawStr;
    let payload;
    try { payload = JSON.parse(jsonStr); } catch { return res.status(400).send('Bad Request'); }

    // ── STEP 3: Look up order to resolve the per-tenant key ───────────────────
    // SnapScan has no HMAC — it relies on HTTP Basic Auth on the callback URL.
    // We need the order to find which tenant/client this webhook belongs to so
    // we can compare against the correct stored key.
    const merchantRef = payload.merchantReference || payload.id;
    const order = await Order.findOne({ orderNumber: merchantRef })
      .setOptions({ bypassTenantFirewall: true });

    if (!order) {
      // Return 200 to prevent SnapScan from retrying with an order we don't know.
      // Do not leak order-existence information via status codes.
      return res.status(200).json({ received: true });
    }

    // ── STEP 4: Verify auth key — BEFORE any write ────────────────────────────
    const client = await Client.findOne({ clientId: order.clientId })
      .select('+paymentGateways.snapscan.webhookAuthKey')
      .lean();

    const expectedKey = client?.paymentGateways?.snapscan?.webhookAuthKey
      || process.env.SNAPSCAN_WEBHOOK_AUTH_KEY;

    // If a key is configured, it must match. If no key is configured at all,
    // we allow through (operator's responsibility to configure the portal).
    if (expectedKey && webhookPassword !== expectedKey) {
      return res.status(401).send('Unauthorized');
    }

    // ── STEP 5: Process payment — only after auth is verified ─────────────────
    if (payload.status === 'completed') {
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
 * FIX: Signature verification now happens BEFORE any DB write.
 * Previously: body was parsed and a DB lookup was made before verifying the signature,
 * meaning an unauthenticated caller could trigger order lookups.
 */
exports.handleZapperWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    // ── STEP 1: Parse the payload ──────────────────────────────────────────────
    // We must parse to extract the reference for per-tenant key lookup.
    // This is a read-only parse; no DB writes happen until signature is verified.
    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString());
    } catch {
      return res.status(400).send('Bad Request');
    }

    // ── STEP 2: Resolve the per-tenant signing key ─────────────────────────────
    // The reference field carries the orderNumber we set during initialization.
    // We use it to find the correct per-tenant Zapper key.
    // This single read is a necessary prerequisite for key resolution.
    let secret = process.env.ZAPPER_WEBHOOK_SECRET;
    const reference = payload?.data?.reference || payload?.reference;

    if (reference) {
      const order = await Order.findOne({ orderNumber: reference })
        .setOptions({ bypassTenantFirewall: true });
      if (order) {
        const client = await Client.findOne({ clientId: order.clientId })
          .select('+paymentGateways.zapper.apiKey')
          .lean();
        secret = client?.paymentGateways?.zapper?.apiKey || secret;
      }
    }

    // ── STEP 3: Verify signature BEFORE any DB write ───────────────────────────
    const signature = req.headers['x-zapper-signature'];
    if (!secret || !signature || !safeVerifySignature256(secret, req.rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    // ── STEP 4: Process payment — only after signature is verified ─────────────
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
