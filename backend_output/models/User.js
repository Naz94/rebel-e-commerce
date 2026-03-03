const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true,
      index: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false 
    },
    firstName: {
      type: String,
      required: [true, 'First name is required']
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required']
    },
    phone: String,
    role: {
      type: String,
      enum: ['owner', 'admin', 'staff', 'readonly'],
      default: 'staff'
    },
    permissions: {
      products: { type: [String], default: ['view'] },
      orders: { type: [String], default: ['view'] },
      customers: { type: [String], default: ['view'] },
      analytics: { type: [String], default: ['view'] },
      settings: { type: [String], default: [] },
      users: { type: [String], default: [] }
    },
    lastLogin: Date,
    loginCount: {
      type: Number,
      default: 0
    },
    lastIP: String,
    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted'],
      default: 'active'
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    emailVerified: {
      type: Boolean,
      default: false
    },
    emailVerificationToken: String,
    emailVerificationExpire: Date
  },
  {
    timestamps: true
  }
);

UserSchema.index({ clientId: 1, email: 1 }, { unique: true });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * getSignedJwtToken
 * Updated: includes 'type' to support optimized protect middleware.
 */
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, type: 'staff' }, 
    process.env.JWT_SECRET, 
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

UserSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

UserSchema.methods.recordLogin = function (ipAddress) {
  this.lastLogin = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
  if (ipAddress) this.lastIP = ipAddress;
};

UserSchema.methods.hasPermission = function (resource, action) {
  if (this.role === 'owner') return true;
  return this.permissions[resource]?.includes(action) || false;
};

module.exports = mongoose.model('User', UserSchema);
