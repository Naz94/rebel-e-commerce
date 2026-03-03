const crypto = require('crypto');
const User = require('../models/User');
const { ErrorResponse } = require('../middleware/error');
const sendEmail = require('../utils/sendEmail');

// Helper: Promise-based sleep for anti-enumeration
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @desc    Public User Registration
 * @route   POST /api/v1/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const PUBLIC_ROLES = ['customer', 'user'];
    const finalRole = PUBLIC_ROLES.includes(role) ? role : 'customer';

    const user = await User.create({
      name,
      email,
      password,
      role: finalRole,
      clientId: req.clientId
    });

    sendTokenResponse(user, 201, res);
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Login User
 * @route   POST /api/v1/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new ErrorResponse('Please provide email and password', 400));
    }

    const user = await User.findOne({ email, clientId: req.clientId }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return next(new ErrorResponse('Invalid credentials', 401));
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Secure Forgot Password
 * @route   POST /api/v1/auth/forgotpassword
 * @note    Padding delay limits enumeration, though email delivery time remains a side-channel.
 */
exports.forgotPassword = async (req, res, next) => {
  const start = Date.now();
  
  try {
    const user = await User.findOne({ email: req.body.email, clientId: req.clientId });

    if (!user) {
      const elapsed = Date.now() - start;
      await sleep(Math.max(0, 450 - elapsed)); // Adjusted baseline
      return res.status(200).json({ success: true, data: 'Email sent' });
    }

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/auth/resetpassword/${resetToken}`;
    const message = `A password reset was requested. Please use the following link: \n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset',
        message
      });

      console.log(`[AUTH] Reset triggered for Tenant: ${req.clientId}`);
      res.status(200).json({ success: true, data: 'Email sent' });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return next(new ErrorResponse('Email could not be sent', 500));
    }
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Reset Password via Token
 * @route   PUT /api/v1/auth/resetpassword/:resetToken
 */
exports.resetPassword = async (req, res, next) => {
  try {
    // 1. Presence check for password
    if (!req.body.password) {
      return next(new ErrorResponse('New password is required', 400));
    }

    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resetToken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) return next(new ErrorResponse('Invalid or expired token', 400));

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
};

// --- Helper: JWT and Cookie Delivery ---
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();

  // 2. Safe fallback for missing env var
  const expireDays = parseInt(process.env.JWT_COOKIE_EXPIRE, 10) || 7;

  const options = {
    expires: new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  };

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token // Provided for mobile/SPA clients (should be stored in secure memory)
  });
};