const crypto   = require('crypto');
const mongoose = require('mongoose');
const Order    = require('../models/Order');

// ─────────────────────────────────────────────────────────────────────────────
// 1. ATOMIC DB HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const resolveSuccess = async (orderId, transactionId, session, clientId) => {
  if (!mongoose.isValidObjectId(orderId)) throw new Error('Invalid Order ID');

  const order = await Order.findOne({ _id: orderId, clientId }).session(session);
  if (!order) {
    // Do not reveal whether the order exists on another tenant — generic error
    throw new Error('[SECURITY] Order not found for the current tenant context.');
  }

  return await order.markAsPaid(
    transactionId,
    order.totals.total,
    order.payment.method || 'manual',
    { session }
  );
};

const resolveFailure = async (orderId, session, clientId, reason = 'Payment Failed') => {
  if (!mongoose.isValidObjectId(orderId)) throw new Error('Invalid Order ID');

  const order = await Order.findOne({ _id: orderId, clientId }).session(session);
  if (order) {
    await order.cancelOrder(reason, { session });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. SIGNATURE VERIFICATION
//
// FIX C-5: The original code looked up secrets using the pattern
//   process.env[`${provider.toUpperCase()}_SECRET_KEY`]
// but all other webhook handlers in controllers/payments.js use
//   process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`]
// The mismatch meant this generic handler would NEVER find its secret key and
// would reject every webhook with 401. Now using the consistent *_WEBHOOK_SECRET
// pattern. Ensure .env contains: PAYSTACK_WEBHOOK_SECRET, YOCO_WEBHOOK_SECRET, etc.
//
// Always uses req.rawBody (Buffer) — never re-stringified JSON.
// ─────────────────────────────────────────────────────────────────────────────
const verifyGatewaySignature = (provider, rawBody, headers) => {
  // FIX C-5: use *_WEBHOOK_SECRET naming, consistent with payments.js
  const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret) return false;

  const signature = headers['x-webhook-signature']
    || headers['x-paystack-signature']
    || headers['x-yoco-signature'];
  if (!signature) return false;

  const hash = crypto.createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. GENERIC WEBHOOK ENTRY POINT
// Handles all providers via /api/v1/checkout/webhook/:provider
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = async (req, res) => {
  const { provider } = req.params;
  const session = await mongoose.startSession();

  try {
    // req.body is still the raw Buffer here because server.js applies
    // express.raw() before express.json() for this path.
    if (!verifyGatewaySignature(provider, req.rawBody, req.headers)) {
      console.warn(JSON.stringify({
        type:     'WEBHOOK_INVALID_SIGNATURE',
        provider,
        ip:       req.ip
      }));
      return res.status(401).send('Unauthorized');
    }

    const payload = JSON.parse(req.rawBody.toString());

    await session.withTransaction(async () => {
      const clientId = payload.metadata?.clientId;
      const orderId  = payload.metadata?.orderId;
      const transId  = payload.id || payload.reference;

      if (!clientId || !orderId) throw new Error('MISSING_TENANT_CONTEXT');

      let outcome = 'ignore';
      const status = (payload.status || payload.data?.status || '').toLowerCase();

      if (['success', 'successful', 'completed', 'paid'].includes(status)) outcome = 'success';
      if (['failed', 'declined', 'expired'].includes(status))              outcome = 'failure';

      if (outcome === 'success') {
        await resolveSuccess(orderId, transId, session, clientId);
      } else if (outcome === 'failure') {
        await resolveFailure(orderId, session, clientId);
      }
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error(JSON.stringify({
      type:     'WEBHOOK_FAILURE',
      provider,
      clientId: (() => {
        try { return JSON.parse(req.rawBody.toString())?.metadata?.clientId; }
        catch { return 'unknown'; }
      })(),
      error: error.message
    }));
    res.status(500).send('Internal Error');
  } finally {
    // FIX C-6: endSession was not awaited — can leak MongoDB sessions under load
    await session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. MANUAL PAYMENT CONFIRMATION
// FIX M-2: orderId and reference are validated for presence before use.
// Previously, undefined orderId was silently passed to resolveSuccess which
// threw a misleading 'Invalid Order ID' error with no user-facing explanation.
// ─────────────────────────────────────────────────────────────────────────────
exports.confirmManualPayment = async (req, res) => {
  if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const { orderId, reference, provider = 'EFT' } = req.body;
  const clientId = req.clientId;

  // FIX M-2: explicit presence validation before touching the DB
  if (!orderId)    return res.status(400).json({ success: false, message: 'orderId is required' });
  if (!reference)  return res.status(400).json({ success: false, message: 'reference is required' });
  if (!mongoose.isValidObjectId(orderId)) {
    return res.status(400).json({ success: false, message: 'Invalid orderId format' });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await resolveSuccess(orderId, `${provider}-${reference}`, session, clientId);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};
