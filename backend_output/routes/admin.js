const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');
const { getAllOrders, getOrder, markAsPaid, cancelOrder } = require('../controllers/orders');
const { getSettings } = require('../controllers/settings');
const Order = require('../models/Order');
const Client = require('../models/Client');

router.use(protect, staffOnly);

// ── Orders ──
router.get('/orders', checkPermission('orders', 'view'), getAllOrders);

// IMPORTANT: static sub-routes BEFORE /:id
router.get('/orders/pending-eft', checkPermission('orders', 'view'), async (req, res) => {
  try {
    const orders = await Order.find({
      clientId:         req.clientId,
      'payment.method': 'eft',
      'payment.status': 'pending',
      'fulfillment.status': { $nin: ['cancelled'] }
    }).sort({ createdAt: -1 }).lean();

    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load pending EFTs' });
  }
});

router.get('/orders/:id', checkPermission('orders', 'view'), getOrder);

router.patch('/orders/:id/status', checkPermission('orders', 'edit'), async (req, res) => {
  const { status } = req.body;
  const VALID = ['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'];
  if (!status || !VALID.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${VALID.join(', ')}` });
  }

  if (status === 'cancelled') {
    req.body.reason = req.body.reason || 'Cancelled by merchant';
    return cancelOrder(req, res);
  }

  const session = await mongoose.startSession();
  try {
    let savedOrder;
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: req.params.id, clientId: req.clientId }, null, { session });
      if (!order) throw new Error('Order not found');
      order.fulfillment.status = status;
      order.addTimelineEvent('status_updated', `Status changed to "${status}" by staff`);
      savedOrder = await order.save({ session });
    });
    res.json({ success: true, data: savedOrder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to update status' });
  } finally {
    await session.endSession();
  }
});

router.patch('/orders/:id/verify-eft', checkPermission('orders', 'edit'), async (req, res) => {
  const { status } = req.body;
  if (!['success', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'status must be "success" or "failed"' });
  }
  if (status === 'failed') {
    req.body.reason = 'EFT payment rejected by merchant';
    return cancelOrder(req, res);
  }
  req.params.id = req.params.id;
  req.body.provider = 'manual_eft';
  req.body.reference = req.body.reference || `EFT-${Date.now()}`;
  return markAsPaid(req, res);
});

// ── Settings ──
router.get('/tenant/settings', getSettings);

router.put('/tenant/settings', checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const {
      shopName, storeName, description, website, facebook, instagram,
      email, phone, whatsapp, address,
      bankName, accountHolder, accountNumber, branchCode, eftReferencePrefix
    } = req.body;

    const $set = {};
    const name = shopName || storeName;
    if (name)                       $set['settings.storeName']           = name;
    if (description !== undefined)  $set['settings.description']         = description;
    if (website !== undefined)      $set['social.website']               = website;
    if (facebook !== undefined)     $set['social.facebook']              = facebook;
    if (instagram !== undefined)    $set['social.instagram']             = instagram;
    if (email !== undefined)        $set['contact.email']                = email;
    if (phone !== undefined)        $set['contact.phone']                = phone;
    if (whatsapp !== undefined)     $set['contact.whatsapp']             = whatsapp;
    if (address !== undefined)      $set['contact.address']              = address;
    if (bankName !== undefined)     $set['banking.bankName']             = bankName;
    if (accountHolder !== undefined) $set['banking.accountHolder']       = accountHolder;
    if (accountNumber !== undefined) $set['banking.accountNumber']       = accountNumber;
    if (branchCode !== undefined)   $set['banking.branchCode']           = branchCode;
    if (eftReferencePrefix !== undefined) $set['banking.eftReferencePrefix'] = eftReferencePrefix;

    if (!Object.keys($set).length) {
      return res.status(400).json({ success: false, message: 'No fields provided' });
    }

    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId },
      { $set },
      { new: true, runValidators: false }
    );
    if (!client) return res.status(404).json({ success: false, message: 'Store not found' });

    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save settings' });
  }
});

module.exports = router;
