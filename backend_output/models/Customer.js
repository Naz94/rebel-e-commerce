const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const CustomerSchema = new mongoose.Schema(
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
    accountStatus: {
      type: String,
      enum: ['active', 'inactive', 'deleted'],
      default: 'active'
    },
    lastLogin: Date,
    loginCount: {
      type: Number,
      default: 0
    },
    addresses: [
      {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
        isDefault: Boolean
      }
    ],
    marketing: {
      emailSubscribed: {
        type: Boolean,
        default: false
      },
      subscribedAt: Date
    },
    totalSpent: {
      type: Number,
      default: 0
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    tags: [String],
    notes: String
  },
  {
    timestamps: true
  }
);

CustomerSchema.index({ clientId: 1, email: 1 }, { unique: true });

CustomerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

CustomerSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * getSignedJwtToken
 * Updated: includes 'type' to support optimized protect middleware.
 */
CustomerSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    {
      id: this._id,
      clientId: this.clientId,
      type: 'customer'
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

CustomerSchema.methods.updateStatsAfterOrder = async function (amount) {
  this.totalSpent = (this.totalSpent || 0) + amount;
  this.totalOrders = (this.totalOrders || 0) + 1;
  await this.save();
};

CustomerSchema.methods.recordLogin = function () {
  this.lastLogin = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
};

module.exports = mongoose.model('Customer', CustomerSchema);
