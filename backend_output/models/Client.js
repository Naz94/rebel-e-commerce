const mongoose = require('mongoose');

/**
 * SECURE: Defensive sanitization applied to both toJSON and toObject.
 * Uses optional chaining uniformly to prevent runtime errors on null nested fields.
 * Strips internal versioning (__v) and all known secret fields.
 */
const sanitizeClient = (doc, ret) => {
  delete ret.__v;
  if (ret.email?.smtpPassword) delete ret.email.smtpPassword;
  // Strip all payment gateway secrets
  if (ret.paymentGateways?.paystack?.secretKey)       delete ret.paymentGateways.paystack.secretKey;
  if (ret.paymentGateways?.yoco?.secretKey)           delete ret.paymentGateways.yoco.secretKey;
  if (ret.paymentGateways?.ozow?.privateKey)          delete ret.paymentGateways.ozow.privateKey;
  if (ret.paymentGateways?.ozow?.apiKey)              delete ret.paymentGateways.ozow.apiKey;
  if (ret.paymentGateways?.ikhokha?.signSecret)       delete ret.paymentGateways.ikhokha.signSecret;
  if (ret.paymentGateways?.snapscan?.apiKey)          delete ret.paymentGateways.snapscan.apiKey;
  if (ret.paymentGateways?.snapscan?.webhookAuthKey)  delete ret.paymentGateways.snapscan.webhookAuthKey;
  if (ret.paymentGateways?.zapper?.apiKey)            delete ret.paymentGateways.zapper.apiKey;
  return ret;
};

const ClientSchema = new mongoose.Schema(
  {
    // Core Identity
    clientId: {
      type: String,
      required: [true, 'clientId is required'],
      unique: true,   // unique automatically creates an index; index: true omitted
      trim: true      // Prevents whitespace-driven lookup mismatches
    },
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true
    },
    subdomain: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      match: [/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Invalid subdomain format']
    },

    // Hardened Branding
    branding: {
      primaryColor: {
        type: String,
        default: '#1a1a2e',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid hex color']
      },
      secondaryColor: {
        type: String,
        default: '#ffffff',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Invalid hex color']
      },
      logoUrl: {
        type: String,
        validate: {
          // Standard function (not arrow) to preserve Mongoose 'this' context
          validator: function (v) { return !v || /^(https?:\/\/)/.test(v); },
          message: 'Logo URL must use HTTP or HTTPS'
        }
      }
    },

    // Contact (all fields validated)
    contact: {
      ownerName: String,
      email: {
        type: String,
        match: [/^\S+@\S+\.\S+$/, 'Invalid email format']
      },
      phone: {
        type: String,
        match: [/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone format']
      }
    },

    // Subscription
    tier: {
      type: String,
      enum: ['starter', 'professional', 'business', 'enterprise'],
      default: 'starter'
    },

    // Managed exclusively by tier hooks — do not set manually
    limits: {
      products: { type: Number, default: 25 },
      users: { type: Number, default: 1 },
      ordersPerMonth: { type: Number, default: 100 } // Aligns with 'starter' tier
    },

    // Declarative feature record for application-level gatekeeping
    features: {
      abandonedCart: { type: Boolean, default: false },
      multiUser: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
      customReports: { type: Boolean, default: false }
    },

    // Infrastructure — secrets protected by select: false + toJSON/toObject transform
    email: {
      smtpHost: String,
      smtpPort: Number,
      smtpUser: String,
      smtpPassword: { type: String, select: false },
      fromName: String,
      fromEmail: String
    },
    paymentGateways: {
      paystack: {
        enabled: { type: Boolean, default: false },
        publicKey: String,
        secretKey: { type: String, select: false }
      },
      yoco: {
        enabled: { type: Boolean, default: false },
        publicKey: String,
        secretKey: { type: String, select: false }
      },
      ozow: {
        enabled: { type: Boolean, default: false },
        siteCode: String,
        privateKey: { type: String, select: false },
        apiKey: { type: String, select: false },
        isTest: { type: Boolean, default: true }
      },
      ikhokha: {
        enabled: { type: Boolean, default: false },
        appId: String,
        signSecret: { type: String, select: false },
        isTest: { type: Boolean, default: true }
      },
      snapscan: {
        enabled: { type: Boolean, default: false },
        snapCode: String,
        apiKey: { type: String, select: false },
        webhookAuthKey: { type: String, select: false }
      },
      zapper: {
        enabled: { type: Boolean, default: false },
        merchantId: String,
        siteId: String,
        apiKey: { type: String, select: false }
      },
      manualEft: {
        enabled: { type: Boolean, default: false },
        bankDetails: {
          bankName: String,
          accountHolder: String,
          accountNumber: String,
          branchCode: String,
          accountType: String
        }
      }
    },

    // Lifecycle status — indexed for health-check and filtering queries
    status: {
      type: String,
      enum: ['active', 'suspended', 'cancelled', 'deleted'],
      default: 'active',
      index: true
    },

    // Banking details for EFT payments (shown to customers at checkout)
    banking: {
      bankName:         String,
      accountHolder:    String,
      accountNumber:    String,
      branchCode:       String,
      accountType:      { type: String, default: 'Current' },
      eftReferencePrefix: { type: String, default: 'ORD' }
    },

    // Store-level settings
    settings: {
      storeName:    String,
      description:  String,
      currency:     { type: String, default: 'ZAR' },
      taxRate:      { type: Number, default: 0.15, min: 0, max: 0.30 },
      timezone:     { type: String, default: 'Africa/Johannesburg' },
      orderExpiry:  { type: Number, default: 120 }  // minutes
    },

    // Social & contact info
    social: {
      website:   String,
      facebook:  String,
      instagram: String,
      twitter:   String,
      tiktok:    String,
      whatsapp:  String
    }
  },
  {
    timestamps: true,
    // Sanitization applied to all serialization paths
    toJSON: { transform: sanitizeClient },
    toObject: { transform: sanitizeClient }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// IMMUTABLE TIER CONFIGURATION
// Deep-frozen to prevent both external and internal mutation.
// ─────────────────────────────────────────────────────────────────────────────

const deepFreeze = (obj) => {
  Object.freeze(obj);
  Object.values(obj).forEach(v => v && typeof v === 'object' && deepFreeze(v));
  return obj;
};

const TIER_CONFIG = deepFreeze({
  starter: {
    products: 25, users: 1, orders: 100,
    features: { abandonedCart: false, multiUser: false, apiAccess: false, customReports: false }
  },
  professional: {
    products: 100, users: 2, orders: 500,
    features: { abandonedCart: true, multiUser: false, apiAccess: false, customReports: false }
  },
  business: {
    products: 500, users: 5, orders: 2000,
    features: { abandonedCart: true, multiUser: true, apiAccess: true, customReports: true }
  },
  enterprise: {
    products: -1, users: -1, orders: -1,
    features: { abandonedCart: true, multiUser: true, apiAccess: true, customReports: true }
  }
});

/**
 * getTierSettings
 * Returns a deep clone to prevent accidental mutation of TIER_CONFIG.
 * Returns null for unknown tiers — callers must handle null explicitly.
 */
const getTierSettings = (tier) => {
  const config = TIER_CONFIG[tier];
  return config ? JSON.parse(JSON.stringify(config)) : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// TIER HOOKS
// ─────────────────────────────────────────────────────────────────────────────

// Hook 1: Handles .save() — create and full document updates
ClientSchema.pre('save', function (next) {
  if (!this.isModified('tier')) return next();

  const settings = getTierSettings(this.tier);
  if (!settings) return next(new Error(`Invalid tier: ${this.tier}`));

  this.limits.products = settings.products;
  this.limits.users = settings.users;
  this.limits.ordersPerMonth = settings.orders;
  // Full assignment (not spread) ensures all flags reset correctly on downgrade
  this.features = settings.features;
  next();
});

// Hook 2: Handles .findOneAndUpdate() — atomic tier changes
ClientSchema.pre('findOneAndUpdate', function (next) {
  // Enforce validators on all findOneAndUpdate calls across the model
  this.setOptions({ runValidators: true, context: 'query' });

  const update = this.getUpdate();
  const tier = update?.$set?.tier ?? update?.tier;

  if (!tier) return next();

  const settings = getTierSettings(tier);
  if (!settings) return next(new Error(`Invalid tier: ${tier}`));

  // Normalise to $set — handles both $set-style and replacement-style updates
  const base = update.$set ? { ...update.$set } : { ...update };

  this.setUpdate({
    ...update,
    $set: {
      ...base,
      tier,
      'limits.products': settings.products,
      'limits.users': settings.users,
      'limits.ordersPerMonth': settings.orders,
      'features.abandonedCart': settings.features.abandonedCart,
      'features.multiUser': settings.features.multiUser,
      'features.apiAccess': settings.features.apiAccess,
      'features.customReports': settings.features.customReports
    }
  });
  next();
});

const Client = mongoose.model('Client', ClientSchema);

module.exports = Client;
module.exports.getTierSettings = getTierSettings;