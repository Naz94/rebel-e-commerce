const express = require('express');
const router = express.Router();
const {
  staffRegister, staffLogin, customerLogin, getCurrentCustomer,
  protect, extractClientId, optionalAuth
} = require('../middleware/auth');

const crypto = require('crypto');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { ErrorResponse } = require('../middleware/error');

// ─────────────────────────────────────────────
// STAFF ROUTES
// Dashboard calls POST /auth/login and GET /auth/me
// ─────────────────────────────────────────────

// POST /api/v1/auth/register
router.post('/register', extractClientId, staffRegister);

// POST /api/v1/auth/login  (dashboard uses this)
router.post('/login', extractClientId, staffLogin);

// GET /api/v1/auth/me  (dashboard calls /auth/staff/me — alias below)
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, data: req.user });
});

// PUT /api/v1/auth/update-password
router.put('/update-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!(await user.comparePassword(currentPassword))) {
      return next(new ErrorResponse('Current password is incorrect', 401));
    }

    user.password = newPassword;
    await user.save();
    const token = user.getSignedJwtToken();
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/logout
router.get('/logout', (req, res) => {
  res.cookie('token', 'none', { expires: new Date(Date.now() + 10 * 1000), httpOnly: true });
  res.json({ success: true, message: 'Logged out' });
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', extractClientId, async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, clientId: req.clientId });
    if (!user) return res.status(200).json({ success: true, data: 'Email sent' });

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
    // In production, send email. For now, return token in dev.
    if (process.env.NODE_ENV === 'development') {
      return res.json({ success: true, resetToken });
    }
    res.json({ success: true, data: 'Email sent' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/auth/reset-password/:resetToken
router.put('/reset-password/:resetToken', async (req, res, next) => {
  try {
    if (!req.body.password) return next(new ErrorResponse('New password required', 400));

    const resetPasswordToken = crypto.createHash('sha256').update(req.params.resetToken).digest('hex');
    const user = await User.findOne({ resetPasswordToken, resetPasswordExpire: { $gt: Date.now() } });

    if (!user) return next(new ErrorResponse('Invalid or expired token', 400));

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    const token = user.getSignedJwtToken();
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
// DASHBOARD ALIASES
// client-dashboard.html calls /auth/staff/login and /auth/staff/me
// These aliases forward to the same handlers
// ─────────────────────────────────────────────
router.post('/staff/login', extractClientId, staffLogin);
router.get('/staff/me', protect, async (req, res) => {
  res.json({ success: true, data: req.user });
});
router.put('/staff/update-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return next(new ErrorResponse('Current password is incorrect', 401));
    }
    user.password = newPassword;
    await user.save();
    const token = user.getSignedJwtToken();
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
// CUSTOMER ROUTES
// ─────────────────────────────────────────────
router.post('/customer/register', extractClientId, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    const customer = await Customer.create({
      clientId: req.clientId, email, password, firstName, lastName, phone
    });
    const token = customer.getSignedJwtToken();
    res.status(201).json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

router.post('/customer/login', extractClientId, customerLogin);
router.get('/customer/me', protect, getCurrentCustomer);

module.exports = router;
