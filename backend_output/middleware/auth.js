'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Client = require('../models/Client');
const { ErrorResponse } = require('../middleware/error');

// =====================
// CLIENT RESOLUTION
// =====================
exports.extractClientId = async (req, res, next) => {
  try {
    const clientId = req.headers['x-client-id'] || req.query.clientId;

    if (!clientId) {
      return next(new ErrorResponse('clientId is required (x-client-id header)', 400));
    }

    const client = await Client.findOne({ clientId, status: 'active' }).lean();
    if (!client) {
      return next(new ErrorResponse('Invalid store context', 404));
    }

    req.clientId = clientId;
    req.client = client;

    next();
  } catch (error) {
    next(error);
  }
};

exports.getClientFromDomain = exports.extractClientId;
exports.getClient = exports.extractClientId;

// =====================
// PROTECT (JWT AUTH)
// =====================
exports.protect = async (req, res, next) => {
  try {
    let token =
      req.headers.authorization?.startsWith('Bearer')
        ? req.headers.authorization.split(' ')[1]
        : req.cookies?.token || null;

    if (!token) {
      return next(new ErrorResponse('Login required', 401));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.type || !decoded.id) {
      return next(new ErrorResponse('Invalid token', 401));
    }

    // 🔴 ISSUE 1 FIX — JWT clientId validation (added)
    if (decoded.clientId && req.clientId && decoded.clientId !== req.clientId) {
      return next(new ErrorResponse('Token tenant mismatch', 403));
    }

    // =====================
    // STAFF
    // =====================
    if (decoded.type === 'staff') {
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new ErrorResponse('User not found', 401));
      }

      if (req.clientId && req.clientId !== user.clientId) {
        return next(new ErrorResponse('Token tenant mismatch', 403));
      }

      req.user = user;
      req.userType = 'staff';

      // 🔴 ISSUE 2 FIX — no silent overwrite
      req.clientId = user.clientId;

      return next();
    }

    // =====================
    // CUSTOMER
    // =====================
    if (decoded.type === 'customer') {
      const customer = await Customer.findById(decoded.id);

      if (!customer) {
        return next(new ErrorResponse('Customer not found', 401));
      }

      if (req.clientId && req.clientId !== customer.clientId) {
        return next(new ErrorResponse('Token tenant mismatch', 403));
      }

      req.customer = customer;
      req.userType = 'customer';

      // 🔴 ISSUE 2 FIX — no silent overwrite
      req.clientId = customer.clientId;

      return next();
    }

    return next(new ErrorResponse('Invalid token type', 401));
  } catch (error) {
    return next(new ErrorResponse('Invalid or expired session', 401));
  }
};

// =====================
// OPTIONAL AUTH
// =====================
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer')
      ? req.headers.authorization.split(' ')[1]
      : null;

    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.type || !decoded.id) return next();

    if (decoded.type === 'staff') {
      const user = await User.findById(decoded.id);

      if (user) {
        // 🔴 ISSUE 3 FIX — enforce tenant mismatch even in optional auth
        if (decoded.clientId && req.clientId && decoded.clientId !== req.clientId) {
          return next(new ErrorResponse('Token tenant mismatch', 403));
        }

        req.user = user;
        req.userType = 'staff';
        req.clientId = user.clientId;
      }
    }

    if (decoded.type === 'customer') {
      const customer = await Customer.findById(decoded.id);

      if (customer) {
        // 🔴 ISSUE 3 FIX — enforce tenant mismatch
        if (decoded.clientId && req.clientId && decoded.clientId !== req.clientId) {
          return next(new ErrorResponse('Token tenant mismatch', 403));
        }

        req.customer = customer;
        req.userType = 'customer';
        req.clientId = customer.clientId;
      }
    }

    next();
  } catch {
    next();
  }
};

// =====================
// RBAC
// =====================
exports.staffOnly = (req, res, next) => {
  if (req.userType !== 'staff') {
    return next(new ErrorResponse('Staff access only', 403));
  }
  next();
};

exports.checkPermission = (resource, action) => (req, res, next) => {
  if (req.user?.role === 'owner' || req.user?.role === 'admin') {
    return next();
  }

  if (req.user?.permissions?.[resource]?.includes(action)) {
    return next();
  }

  return next(new ErrorResponse(`No ${action} permission for ${resource}`, 403));
};

// =====================
// STAFF REGISTER
// =====================
exports.staffRegister = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;

    const ASSIGNABLE_ROLES = ['staff', 'readonly'];
    const finalRole = ASSIGNABLE_ROLES.includes(role) ? role : 'staff';

    const user = await User.create({
      clientId: req.clientId,
      email,
      password,
      firstName,
      lastName,
      role: finalRole
    });

    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      token,
      data: { id: user._id, role: user.role }
    });
  } catch (error) {
    next(error);
  }
};

// =====================
// STAFF LOGIN
// =====================
exports.staffLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email,
      clientId: req.clientId
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    user.recordLogin(req.ip);
    await user.save({ validateBeforeSave: false });

    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      token
    });
  } catch (error) {
    next(error);
  }
};

// =====================
// CUSTOMER LOGIN
// =====================
exports.customerLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const customer = await Customer.findOne({
      email,
      clientId: req.clientId
    }).select('+password');

    if (!customer || !(await customer.comparePassword(password))) {
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    const token = customer.getSignedJwtToken();

    res.json({
      success: true,
      token
    });
  } catch (error) {
    next(error);
  }
};

// =====================
// CURRENT CUSTOMER
// =====================
exports.getCurrentCustomer = (req, res) => {
  res.json({
    success: true,
    data: req.customer
  });
};
