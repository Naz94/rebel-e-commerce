const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const { protect, staffOnly } = require('../middleware/auth');

// FIX: All routes require authentication. The original file had no superadmin
// guard on GET routes, meaning any authenticated staff member could list all tenants.
// Only superadmins should have access to the cross-tenant client list.

const requireSuperadmin = (req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin access required' });
  }
  next();
};

// Get all clients (superadmin only)
router.get('/', protect, staffOnly, requireSuperadmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const clients = await Client.find({ status: { $ne: 'deleted' } })
      .select('businessName clientId tier status createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await Client.countDocuments({ status: { $ne: 'deleted' } });

    res.json({
      success: true,
      pagination: { total, page, pages: Math.ceil(total / limit) },
      data: clients
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single client (superadmin only)
router.get('/:id', protect, staffOnly, requireSuperadmin, async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.params.id });
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    res.json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create client (superadmin only)
router.post('/', protect, staffOnly, requireSuperadmin, async (req, res) => {
  try {
    const { clientId, businessName, tier } = req.body;

    if (!clientId || !businessName) {
      return res.status(400).json({
        success: false,
        message: 'clientId and businessName are required'
      });
    }

    const client = await Client.create({
      clientId,
      businessName,
      tier: tier || 'starter'
    });

    res.status(201).json({
      success: true,
      data: client
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update client (superadmin only)
router.put('/:id', protect, staffOnly, requireSuperadmin, async (req, res) => {
  try {
    // FIX: Whitelist allowed fields — do not allow direct writes to clientId, tier, or status
    const { businessName } = req.body;
    const updates = {};
    if (businessName) updates.businessName = businessName;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided' });
    }

    const client = await Client.findOneAndUpdate(
      { clientId: req.params.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    res.json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;