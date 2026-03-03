const mongoose = require('mongoose');
const Client = require('../models/Client');
const { getTierSettings } = require('../models/Client');
const { ErrorResponse } = require('../middleware/error');
const { invalidateTransporter } = require('../utils/email');

const VALID_STATUSES = ['active', 'suspended', 'cancelled', 'deleted'];

/**
 * @desc    Get public store config (no auth required)
 * @route   GET /api/v1/config/:clientId
 * @access  Public
 *
 * FIX 9: Was imported by server.js but did not exist → startup crash.
 * Returns only public-facing fields; secrets stripped by sanitizeClient transform.
 */
exports.getPublicSettings = async (req, res, next) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId, status: 'active' })
      .select('businessName clientId branding contact settings social storeName description banking');

    if (!client) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    res.status(200).json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all clients (Superadmin only)
 * @route   GET /api/v1/clients
 */
exports.getClients = async (req, res, next) => {
  try {
    if (req.user?.role !== 'superadmin') return next(new ErrorResponse('Not authorized', 403));

    const page  = parseInt(req.query.page,  10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (req.query.status && !VALID_STATUSES.includes(req.query.status)) {
      return next(new ErrorResponse('Invalid status filter', 400));
    }

    const filter = req.query.status
      ? { status: req.query.status }
      : { status: { $ne: 'deleted' } };

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .select('businessName clientId tier status createdAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      Client.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      pagination: { total, page, pages: Math.ceil(total / limit) },
      data: clients
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update client tier
 * @route   PUT /api/v1/clients/:clientId/tier
 */
exports.updateClientTier = async (req, res, next) => {
  try {
    if (req.user?.role !== 'superadmin') return next(new ErrorResponse('Not authorized', 403));

    const { tier } = req.body;
    if (!tier || !getTierSettings(tier)) return next(new ErrorResponse('Invalid subscription tier', 400));

    const client = await Client.findOne({ clientId: req.params.clientId });
    if (!client) return next(new ErrorResponse('Client not found', 404));

    client.tier = tier;
    await client.save();

    res.status(200).json({ success: true, data: client.toJSON() });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update client details
 * @route   PUT /api/v1/clients/:clientId
 */
exports.updateClient = async (req, res, next) => {
  try {
    if (req.user?.role !== 'superadmin') return next(new ErrorResponse('Not authorized', 403));

    const updates = {};
    const allowed = {
      'businessName':            req.body.businessName,
      'branding.primaryColor':   req.body.branding?.primaryColor,
      'branding.secondaryColor': req.body.branding?.secondaryColor,
      'branding.logoUrl':        req.body.branding?.logoUrl,
      'contact.ownerName':       req.body.contact?.ownerName,
      'contact.email':           req.body.contact?.email,
      'contact.phone':           req.body.contact?.phone
    };

    Object.keys(allowed).forEach(key => {
      if (allowed[key] !== undefined) updates[key] = allowed[key];
    });

    if (!Object.keys(updates).length) return next(new ErrorResponse('No valid fields provided', 400));

    const client = await Client.findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!client) return next(new ErrorResponse('Client not found', 404));

    res.status(200).json({ success: true, data: client.toJSON() });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update branding (used by clientRoutes)
 * @route   PUT /api/v1/clients/:id/branding
 */
exports.updateBranding = async (req, res, next) => {
  try {
    const allowed = ['logoUrl', 'primaryColor', 'secondaryColor', 'bannerUrl', 'favicon'];
    const $set = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) $set[`branding.${f}`] = req.body[f];
    });

    if (!Object.keys($set).length) return next(new ErrorResponse('No branding fields provided', 400));

    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId },
      { $set },
      { new: true, runValidators: true }
    );
    if (!client) return next(new ErrorResponse('Client not found', 404));

    res.status(200).json({ success: true, data: client.toJSON() });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new client
 * @route   POST /api/v1/clients
 */
exports.createClient = async (req, res, next) => {
  try {
    if (req.user?.role !== 'superadmin') return next(new ErrorResponse('Not authorized', 403));

    const { businessName, clientId, subdomain, tier, contact } = req.body;

    if (!businessName || !clientId) return next(new ErrorResponse('businessName and clientId are required', 400));
    if (contact?.email && !/^\S+@\S+\.\S+$/.test(contact.email)) return next(new ErrorResponse('Invalid contact email', 400));
    if (contact?.phone && !/^\+?[\d\s\-().]{7,20}$/.test(contact.phone)) return next(new ErrorResponse('Invalid contact phone', 400));
    if (tier && !getTierSettings(tier)) return next(new ErrorResponse('Invalid subscription tier', 400));

    const client = await Client.create({
      businessName, clientId, subdomain,
      tier: tier || 'starter',
      contact: contact ? {
        ownerName: contact.ownerName,
        email:     contact.email,
        phone:     contact.phone
      } : undefined
    });

    res.status(201).json({ success: true, data: client.toJSON() });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Soft delete client
 * @route   DELETE /api/v1/clients/:clientId
 */
exports.deleteClient = async (req, res, next) => {
  if (req.user?.role !== 'superadmin') return next(new ErrorResponse('Unauthorized', 403));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { clientId } = req.params;
    const client = await Client.findOneAndUpdate(
      { clientId, status: { $ne: 'deleted' } },
      { status: 'deleted' },
      { session, new: true, runValidators: true }
    );

    if (!client) {
      await session.abortTransaction();
      return next(new ErrorResponse('Client not found or already deleted', 404));
    }

    await session.commitTransaction();
    invalidateTransporter(clientId);
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    if (session) session.endSession();
  }
};
