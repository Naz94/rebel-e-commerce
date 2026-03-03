const crypto = require('crypto');

/**
 * verifyGatewaySignature
 * Verifies HMAC-SHA512 signatures from SA payment gateways.
 * FIX: Uses rawBody buffer — not re-stringified JSON — to avoid ordering mismatches.
 */
exports.verifyGatewaySignature = (provider, rawBody, headers) => {
  const secret = process.env[`${provider?.toUpperCase()}_SECRET_KEY`]
               || process.env[`${provider?.toUpperCase()}_WEBHOOK_SECRET`];
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
