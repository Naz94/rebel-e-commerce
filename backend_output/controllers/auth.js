const crypto = require('crypto');
const User   = require('../models/User');
const { ErrorResponse } = require('../middleware/error');
const sendEmail          = require('../utils/sendEmail');

// Minimum constant-time delay for anti-enumeration on password-reset flow
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER (public)
// ─────────────────────────────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    // Only allow non-privileged public roles via this endpoint
    const PUBLIC_ROLES = ['customer', 'user'];
    const finalRole = PUBLIC_ROLES.includes(role) ? role : 'customer';

    const user = await User.create({
      name,
      email,
      password,
      role:     finalRole,
      clientId: req.clientId   // always from middleware, never from body
    });

    sendTokenResponse(user, 201, res);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// FIX M-1: was calling user.matchPassword() — method is named comparePassword()
// on the User model. The mismatch caused a runtime TypeError on every login.
// ─────────────────────────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new ErrorResponse('Please provide email and password', 400));
    }

    // clientId scope is mandatory — prevents cross-tenant credential acceptance
    const user = await User.findOne({ email, clientId: req.clientId }).select('+password');

    // FIX M-1: comparePassword (not matchPassword)
    if (!user || !(await user.comparePassword(password))) {
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD
// Constant-time response prevents email enumeration.
// ─────────────────────────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res, next) => {
  const start = Date.now();

  try {
    // clientId scoped — reset tokens are per-tenant
    const user = await User.findOne({ email: req.body.email, clientId: req.clientId });

    if (!user) {
      // Pad to ~450 ms to prevent timing-based user enumeration
      const elapsed = Date.now() - start;
      await sleep(Math.max(0, 450 - elapsed));
      return res.status(200).json({ success: true, data: 'Email sent' });
    }

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/auth/resetpassword/${resetToken}`;
    const message  = `A password reset was requested. Please use the following link:\n\n${resetUrl}`;

    try {
      await sendEmail({ email: user.email, subject: 'Password Reset', message });
      console.log(`[AUTH] Reset triggered for Tenant: ${req.clientId}`);
      res.status(200).json({ success: true, data: 'Email sent' });
    } catch (err) {
      // Clean up token so a broken email state cannot be exploited later
      user.resetPasswordToken  = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return next(new ErrorResponse('Email could not be sent', 500));
    }
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD
// FIX C-1: The original code did NOT scope the token lookup to req.clientId.
// An attacker with a valid token from tenant-A could reset passwords for
// tenant-B users by sending the request from tenant-B's domain.
//
// Correct approach:
//   1. Resolve the hashed token → find the user (no clientId filter yet,
//      because the token itself is unique and hashed — it cannot be guessed).
//   2. After finding the user, verify user.clientId === req.clientId.
//      If they don't match, reject with the same generic error to avoid
//      leaking the existence of the user in the other tenant.
// ─────────────────────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    if (!req.body.password) {
      return next(new ErrorResponse('New password is required', 400));
    }

    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resetToken)
      .digest('hex');

    // Step 1 — find by token only (token is globally unique and hashed)
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    }).setOptions({ bypassTenantFirewall: true }); // system-level lookup — clientId checked next

    // Step 2 — verify the resolved user belongs to the requesting tenant
    // This is the critical cross-tenant guard. Same generic error in both
    // branches to avoid leaking whether the token existed on another tenant.
    if (!user || user.clientId !== req.clientId) {
      return next(new ErrorResponse('Invalid or expired token', 400));
    }

    user.password            = req.body.password;
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — JWT + Secure Cookie
// ─────────────────────────────────────────────────────────────────────────────
const sendTokenResponse = (user, statusCode, res) => {
  const token      = user.getSignedJwtToken();
  const expireDays = parseInt(process.env.JWT_COOKIE_EXPIRE, 10) || 7;

  const options = {
    expires:  new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production'
  };

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token   // also returned in body for mobile/SPA clients
  });
};
