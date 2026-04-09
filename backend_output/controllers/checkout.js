const crypto   = require('crypto');
const mongoose = require('mongoose');
const Order    = require('../models/Order');

// --- 1. CORE DB ATOMIC HELPERS ---

const resolveSuccess = async (orderId, transactionId, session, clientId) => {
  if (!mongoose.isValidObjectId(orderId)) throw new Error('Invalid Order ID');

  const order = await Order.findOne({ _id: orderId, clientId }).session(session);
  if (!order) {
    throw new Error(`[SECURITY] Order ${orderId} not found for tenant ${clientId}`);
  }

  return await order.markAsPaid(
    transactionId,
    order.totals.total,
    order.payment.method || order.payment.provider || 'manual',
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

// --- 2. SIGNATURE VERIFICATION ---
/**
 * Verifies gateway webhook signatures using the raw request body buffer.
 * Re-stringifying req.body (JSON.stringify) produces a different byte sequence
 * because key ordering, whitespace, and unicode handling can differ — always use
 * the original buffer that the gateway actually signed.
 */
const verifyGatewaySignature = (provider, rawBody, headers) => {
  const secret = process.env[`${provider.toUpperCase()}_SECRET_KEY`];
  if (!secret) return false;

  const signature = headers['x-webhook-signature'] || headers['x-paystack-signature'];
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

// --- 3. WEBHOOK ENTRY POINT ---

exports.handleWebhook = async (req, res) => {
  const { provider } = req.params;
  const session = await mongoose.startSession();

  try {
    if (!verifyGatewaySignature(provider, req.body, req.headers)) {
      console.warn(JSON.stringify({
        type:     'WEBHOOK_INVALID_SIGNATURE',
        provider,
        ip:       req.ip
      }));
      return res.status(401).send('Unauthorized');
    }

    const payload = JSON.parse(req.body.toString());

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
        try { return JSON.parse(req.body.toString())?.metadata?.clientId; }
        catch { return 'unknown'; }
      })(),
      error: error.message
    }));
    res.status(500).send('Internal Error');
  } finally {
    session.endSession();
  }
};

// --- 4. MANUAL PAYMENT CONFIRMATION ---

exports.confirmManualPayment = async (req, res) => {
  // FIX: both 'admin' and 'owner' roles should be able to confirm manual payments
  if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { orderId, reference, provider = 'EFT' } = req.body;
  const clientId = req.clientId;
  const session  = await mongoose.startSession();

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
