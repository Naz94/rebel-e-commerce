const { sendEmail, generateOrderConfirmationEmail, generatePaymentReceivedEmail, generateShippingEmail } = require('../utils/email');
const Order = require('../models/Order');
const Client = require('../models/Client');
const { ErrorResponse } = require('../middleware/error');

// @desc    Send order confirmation email
// @route   POST /api/v1/email/order-confirmation/:orderId
// @access  Private
exports.sendOrderConfirmation = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      clientId: req.clientId
    }).populate('items.productId', 'name images');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    const client = await Client.findOne({ clientId: req.clientId });

    const html = generateOrderConfirmationEmail(order, client);

    await sendEmail({
      clientId: req.clientId,
      to: order.customer.email,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html
    });

    // Mark as sent
    order.emailsSent.orderConfirmation = true;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order confirmation email sent'
    });

  } catch (err) {
    next(err);
  }
};

// @desc    Send payment received email
// @route   POST /api/v1/email/payment-received/:orderId
// @access  Private
exports.sendPaymentReceived = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      clientId: req.clientId
    });

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    if (order.payment.status !== 'paid') {
      return next(new ErrorResponse('Order has not been paid', 400));
    }

    const client = await Client.findOne({ clientId: req.clientId });

    const html = generatePaymentReceivedEmail(order, client);

    await sendEmail({
      clientId: req.clientId,
      to: order.customer.email,
      subject: `Payment Received - ${order.orderNumber}`,
      html
    });

    // Mark as sent
    order.emailsSent.paymentReceived = true;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Payment received email sent'
    });

  } catch (err) {
    next(err);
  }
};

// @desc    Send shipping confirmation email
// @route   POST /api/v1/email/shipped/:orderId
// @access  Private
exports.sendShippingConfirmation = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      clientId: req.clientId
    });

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    const client = await Client.findOne({ clientId: req.clientId });

    const html = generateShippingEmail(order, client);

    await sendEmail({
      clientId: req.clientId,
      to: order.customer.email,
      subject: `Your Order Has Shipped! - ${order.orderNumber}`,
      html
    });

    // Mark as sent
    order.emailsSent.shipped = true;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Shipping confirmation email sent'
    });

  } catch (err) {
    next(err);
  }
};

// @desc    Send test email
// @route   POST /api/v1/email/test
// @access  Private
exports.sendTestEmail = async (req, res, next) => {
  try {
    const { to } = req.body;

    if (!to) {
      return next(new ErrorResponse('Please provide recipient email', 400));
    }

    const client = await Client.findOne({ clientId: req.clientId });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Test Email</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; padding: 40px; border-radius: 8px;">
          <h2 style="color: #333; margin: 0 0 20px;">✓ Email Configuration Test</h2>
          <p style="color: #666; line-height: 1.6;">
            This is a test email from <strong>${client.businessName}</strong>.
          </p>
          <p style="color: #666; line-height: 1.6;">
            If you're seeing this, your email configuration is working correctly!
          </p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              Sent from ${client.email.fromEmail}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendEmail({
      clientId: req.clientId,
      to,
      subject: `Test Email from ${client.businessName}`,
      html
    });

    res.status(200).json({
      success: true,
      message: `Test email sent to ${to}`
    });

  } catch (err) {
    next(err);
  }
};

// @desc    Resend order confirmation
// @route   POST /api/v1/email/resend/order-confirmation/:orderId
// @access  Private
exports.resendOrderConfirmation = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      clientId: req.clientId
    }).populate('items.productId', 'name images');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    const client = await Client.findOne({ clientId: req.clientId });

    const html = generateOrderConfirmationEmail(order, client);

    await sendEmail({
      clientId: req.clientId,
      to: order.customer.email,
      subject: `Order Confirmation - ${order.orderNumber} (Resent)`,
      html
    });

    res.status(200).json({
      success: true,
      message: 'Order confirmation email resent'
    });

  } catch (err) {
    next(err);
  }
};
