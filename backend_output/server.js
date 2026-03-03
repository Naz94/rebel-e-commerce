const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const helmet         = require('helmet');
const morgan         = require('morgan');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
require('dotenv').config();

const { errorHandler } = require('./middleware/error');
const startOrderExpiryJob = require('./jobs/expireOrders');

const app = express();

// =====================
// SECURITY MIDDLEWARE
// =====================

app.use(helmet({ contentSecurityPolicy: false }));

const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

app.use('/api/v1/auth', authLimiter);
app.use('/api/',        apiLimiter);

// =====================
// BODY PARSING
// Webhook routes need raw body for HMAC — BEFORE express.json()
// FIX 1: captureRawBody sets req.rawBody explicitly so signature verifiers
// always have a stable Buffer reference regardless of middleware order.
// =====================

const captureRawBody = (req, res, next) => { req.rawBody = req.body; next(); };

app.use('/api/v1/payments/paystack/webhook',  express.raw({ type: 'application/json' }),                captureRawBody);
app.use('/api/v1/payments/yoco/webhook',      express.raw({ type: 'application/json' }),                captureRawBody);
app.use('/api/v1/payments/ozow/webhook',      express.raw({ type: 'application/json' }),                captureRawBody);
app.use('/api/v1/payments/zapper/webhook',    express.raw({ type: 'application/json' }),                captureRawBody);
app.use('/api/v1/payments/snapscan/webhook',  express.raw({ type: 'application/x-www-form-urlencoded' }), captureRawBody);
app.use('/api/v1/checkout/webhook',           express.raw({ type: 'application/json' }),                captureRawBody);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// =====================
// LOGGING
// =====================
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));
else app.use(morgan('combined'));

// =====================
// STATIC FILES
// Backend serves the frontend from the same folder
// =====================
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// =====================
// DATABASE
// =====================
const startDatabase = async () => {
  try {
    if (process.env.NODE_ENV !== 'test') {
      await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      });
      console.log('✅ MongoDB Connected');
      startOrderExpiryJob();
      console.log('✅ Order expiry job started');
    }
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    if (process.env.NODE_ENV !== 'test') process.exit(1);
  }
};
startDatabase();

// =====================
// ROUTES
// =====================
const authRoutes      = require('./routes/auth');
const productRoutes   = require('./routes/productRoutes');
const orderRoutes     = require('./routes/orders');
const customerRoutes  = require('./routes/customers');
const settingsRoutes  = require('./routes/settings');
const uploadRoutes    = require('./routes/upload');
const analyticsRoutes = require('./routes/analytics');
const paymentRoutes   = require('./routes/payments');
const checkoutRoutes  = require('./routes/checkout');
const userRoutes      = require('./routes/users');
const clientRoutes    = require('./routes/clientRoutes');
const emailRoutes     = require('./routes/email');
const backupRoutes    = require('./routes/backups');
const adminRoutes     = require('./routes/admin');

app.use('/api/v1/auth',      authRoutes);
app.use('/api/v1/products',  productRoutes);
app.use('/api/v1/orders',    orderRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/settings',  settingsRoutes);
app.use('/api/v1/upload',    uploadRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/payments',  paymentRoutes);
app.use('/api/v1/checkout',  checkoutRoutes);
app.use('/api/v1/users',     userRoutes);
app.use('/api/v1/clients',   clientRoutes);
app.use('/api/v1/email',     emailRoutes);
app.use('/api/v1/backups',   backupRoutes);
app.use('/api/v1/admin',     adminRoutes);

// =====================
// /api/v1/config/:clientId ALIAS
// rebel-engine.js calls this on every page load to fetch store branding.
// Bridges to getPublicSettings in clientController.
// =====================
const { getPublicSettings } = require('./controllers/clientController');
const { extractClientId }   = require('./middleware/auth');

app.get('/api/v1/config/:clientId', (req, res, next) => {
  req.headers['x-client-id'] = req.params.clientId;
  next();
}, extractClientId, getPublicSettings);

// =====================
// HEALTH CHECK
// =====================
app.get('/api/v1/health', (req, res) => {
  const states = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    success:   true,
    status:    'operational',
    database:  states[mongoose.connection.readyState] || 'unknown',
    timestamp: new Date().toISOString()
  });
});

// =====================
// 404 + ERROR HANDLERS
// =====================
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.originalUrl });
});

app.use(errorHandler);

// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 5000;

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    console.log(`🌐 Dashboard → http://localhost:${PORT}/client-dashboard.html`);
    console.log(`🌐 Store     → http://localhost:${PORT}/index.html`);
  });
}

process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});

module.exports = app;
