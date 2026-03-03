const nodemailer = require('nodemailer');
const Client = require('../models/Client');

// Memory cache to store SMTP connections
// Key: clientId, Value: { transporter, credentials hash }
const transporters = {};

/**
 * SECURE: HTML Escape utility to prevent XSS in email templates.
 */
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const credentialsHash = (client) => {
  return `${client.email.smtpHost}:${client.email.smtpPort}:${client.email.smtpUser}:${client.email.smtpPassword}`;
};

const getTransporter = async (client) => {
  const currentHash = credentialsHash(client);
  const cached = transporters[client.clientId];

  if (cached && cached.hash === currentHash) {
    return cached.transporter;
  }

  if (cached && cached.transporter) {
    cached.transporter.close();
  }

  if (!client.email.smtpHost || !client.email.smtpUser) {
    throw new Error(`Email not configured for ${client.businessName}`);
  }

  const transporter = nodemailer.createTransport({
    host: client.email.smtpHost,
    port: client.email.smtpPort || 587,
    secure: client.email.smtpPort === 465,
    auth: {
      user: client.email.smtpUser,
      pass: client.email.smtpPassword
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    debug: false,
    logger: false
  });

  transporters[client.clientId] = { transporter, hash: currentHash };
  return transporter;
};

exports.invalidateTransporter = (clientId) => {
  if (transporters[clientId]) {
    try { transporters[clientId].transporter.close(); } catch (_) {}
    delete transporters[clientId];
  }
};

exports.sendEmail = async (options) => {
  try {
    const client = await Client.findOne({ clientId: options.clientId });
    if (!client) throw new Error('Client not found');

    const transporter = await getTransporter(client);

    const mailOptions = {
      from: `"${escapeHtml(client.email.fromName || client.businessName)}" <${client.email.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || 'Please enable HTML to view this email.'
    };

    const info = await transporter.sendMail(mailOptions);

    const recipientDomain = options.to.split('@')[1];
    console.log(`✉️ Email sent [${client.clientId}]: ${info.messageId} to @${recipientDomain}`);

    return info;
  } catch (err) {
    console.error(`❌ Email Error [${options.clientId}]: ${err.message}`);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIX: Order totals are stored in full Rands (e.g. 1250.00), NOT cents.
 * The previous implementation divided by 100, rendering R12.50 instead of R1,250.00.
 */
const formatZAR = (rands) => {
  if (!rands && rands !== 0) return 'R 0.00';
  return 'R ' + parseFloat(rands).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const formatAddress = (addr) => {
  if (!addr) return 'No address provided';
  const lines = [
    escapeHtml(addr.streetAddress || addr.street),
    escapeHtml(addr.suburb),
    [escapeHtml(addr.city), escapeHtml(addr.province || addr.state)].filter(Boolean).join(', '),
    escapeHtml(addr.postalCode || addr.zipCode),
    escapeHtml(addr.country || 'South Africa')
  ].filter(Boolean);
  return lines.join('<br>');
};

const formatDate = (isoString) => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE SHELL
// ─────────────────────────────────────────────────────────────────────────────

const wrapTemplate = (client, bodyHtml) => {
  const primary = (client.branding && client.branding.primaryColor) || '#1a1a2e';
  const businessName = escapeHtml(client.businessName || 'Our Store');
  const logoUrl = client.branding?.logoUrl ? escapeHtml(client.branding.logoUrl) : null;
  const year = new Date().getFullYear();

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${businessName}" style="max-height:48px;max-width:180px;display:block;margin:0 auto 8px;">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0 !important; padding:0 !important; background-color:#f4f4f4; }
    @media screen and (max-width:600px) {
      .email-container { width:100% !important; }
      .mobile-pad { padding:24px 16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f4;">
    <tr>
      <td style="padding:24px 16px;">
        <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="max-width:600px;margin:0 auto;border-radius:8px 8px 0 0;overflow:hidden;">
          <tr>
            <td style="background-color:${primary};padding:32px 40px;text-align:center;">
              ${logoBlock}
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">${businessName}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="max-width:600px;margin:0 auto;background-color:#ffffff;">
          <tr>
            <td class="mobile-pad" style="padding:40px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="max-width:600px;margin:0 auto;border-radius:0 0 8px 8px;overflow:hidden;background-color:#f9f9f9;border-top:1px solid #e8e8e8;">
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#999999;">© ${year} ${businessName}. All rights reserved.</p>
              <p style="margin:0;font-size:12px;color:#bbbbbb;">Registered in South Africa · VAT registered</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

exports.generateOrderConfirmationEmail = (order, client) => {
  const primary = (client.branding && client.branding.primaryColor) || '#1a1a2e';
  const customerName = escapeHtml((order.customer && order.customer.name) || 'Valued Customer');
  const orderNumber = escapeHtml(order.orderNumber);

  const itemsRows = (order.items || []).map(item => {
    const name = escapeHtml((item.product && item.product.name) || item.name || 'Product');
    // FIX: priceAtPurchase is in Rands, pass directly to formatZAR (no /100)
    const lineTotal = (item.priceAtPurchase || 0) * (item.quantity || 1);
    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333333;">${name}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#666666;text-align:center;">${item.quantity || 1}</td>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333333;text-align:right;">${formatZAR(lineTotal)}</td>
      </tr>`;
  }).join('');

  const body = `
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111111;">Order Confirmed</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#999999;">Order #${orderNumber} · ${formatDate(order.createdAt)}</p>
    <p style="margin:0 0 24px;font-size:15px;color:#333333;line-height:1.6;">Hi ${customerName},<br><br>Thank you for your order. We've received it and will begin processing shortly.</p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:24px 0;">
      <thead>
        <tr>
          <th style="padding:10px 0;border-bottom:2px solid ${primary};font-size:12px;font-weight:700;color:#999999;text-transform:uppercase;text-align:left;">Item</th>
          <th style="padding:10px 8px;border-bottom:2px solid ${primary};font-size:12px;font-weight:700;color:#999999;text-transform:uppercase;text-align:center;">Qty</th>
          <th style="padding:10px 0;border-bottom:2px solid ${primary};font-size:12px;font-weight:700;color:#999999;text-transform:uppercase;text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:8px 0 24px;">
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#666666;">Subtotal</td>
        <td style="padding:4px 0;font-size:13px;color:#333333;text-align:right;">${formatZAR(order.totals?.subtotal || 0)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#666666;">Shipping</td>
        <td style="padding:4px 0;font-size:13px;color:#333333;text-align:right;">${formatZAR(order.totals?.shipping || 0)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#666666;">VAT (15%)</td>
        <td style="padding:4px 0;font-size:13px;color:#333333;text-align:right;">${formatZAR(order.totals?.tax || 0)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0 4px;font-size:15px;font-weight:700;color:#111111;border-top:2px solid #eeeeee;">Total</td>
        <td style="padding:8px 0 4px;font-size:16px;font-weight:700;color:#111111;text-align:right;border-top:2px solid #eeeeee;">${formatZAR(order.totals?.total || 0)}</td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:24px 0 0;">
      <tr>
        <td style="width:50%;vertical-align:top;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#999999;text-transform:uppercase;">Shipping To</p>
          <p style="margin:0;font-size:14px;color:#333333;line-height:1.7;">${formatAddress(order.shippingAddress)}</p>
        </td>
      </tr>
    </table>`;

  return wrapTemplate(client, body);
};

exports.generatePaymentReceivedEmail = (order, client) => {
  const customerName = escapeHtml((order.customer && order.customer.name) || 'Valued Customer');
  // FIX: totals.total is in Rands — pass directly, formatZAR no longer divides by 100
  const amount = formatZAR(order.totals?.total || 0);
  const body = `
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111111;">Payment Received</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#333333;line-height:1.6;">Hi ${customerName},<br><br>We've received your payment of <strong>${amount}</strong> for order <strong>#${escapeHtml(order.orderNumber)}</strong>. We'll get started on your order right away.</p>`;
  return wrapTemplate(client, body);
};

exports.generateShippingEmail = (order, client) => {
  const customerName = escapeHtml((order.customer && order.customer.name) || 'Valued Customer');
  const trackingNumber = order.fulfillment?.trackingNumber;
  const courier = escapeHtml(order.fulfillment?.courier || '');

  const trackingBlock = trackingNumber
    ? `<p style="margin:16px 0 0;font-size:14px;color:#333333;">Tracking number: <strong>${escapeHtml(trackingNumber)}</strong>${courier ? ` via ${courier}` : ''}</p>`
    : '';

  const body = `
    <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#111111;">Your Order Has Shipped! 🚚</h1>
    <p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.6;">Hi ${customerName},<br><br>Great news! Your order <strong>#${escapeHtml(order.orderNumber)}</strong> is on its way.</p>
    ${trackingBlock}`;
  return wrapTemplate(client, body);
};