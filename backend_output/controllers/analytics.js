const Order    = require('../models/Order');
const Product  = require('../models/Product');
const Customer = require('../models/Customer');

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const _ensureTenant = (req) => {
  if (!req.clientId) {
    const error = new Error('Tenant Context Missing');
    error.isSecurityError = true;
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD OVERVIEW
// FIX C-9: inventoryValue was computed via Product.aggregate() directly,
// bypassing the tenant firewall. Now uses Product.aggregateForTenant() which
// prepends a mandatory $match on clientId — same pattern as Order.aggregateForTenant().
// ─────────────────────────────────────────────────────────────────────────────
exports.getDashboardOverview = async (req, res) => {
  try {
    _ensureTenant(req);

    const { startDate, endDate } = req.query;

    const start = startDate && !isNaN(Date.parse(startDate))
      ? new Date(startDate)
      : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate && !isNaN(Date.parse(endDate))
      ? new Date(endDate)
      : new Date();

    if ((end - start) / (1000 * 60 * 60 * 24) > 366) {
      return res.status(400).json({ success: false, message: 'Date range cannot exceed 1 year' });
    }

    // Order revenue aggregation — tenant-scoped
    const stats = await Order.aggregateForTenant(req.clientId, [
      {
        $match: {
          'payment.status': 'paid',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id:           null,
          totalRevenue:  { $sum: '$totals.total' },
          totalTax:      { $sum: '$totals.tax' },
          totalShipping: { $sum: '$totals.shipping' },
          totalOrders:   { $sum: 1 },
          avgOrderValue: { $avg: '$totals.total' }
        }
      },
      {
        $project: {
          _id:           0,
          totalRevenue:  { $round: ['$totalRevenue',  2] },
          totalTax:      { $round: ['$totalTax',      2] },
          totalShipping: { $round: ['$totalShipping', 2] },
          totalOrders:   1,
          avgOrderValue: { $round: ['$avgOrderValue', 2] }
        }
      }
    ]);

    const activeCustomers = await Customer.countDocuments({
      clientId:      req.clientId,
      accountStatus: 'active'
    });

    // FIX C-9: use Product.aggregateForTenant() — not Product.aggregate() —
    // so the tenant $match is enforced at the model level, not just inline.
    const inventoryResult = await Product.aggregateForTenant(req.clientId, [
      {
        $match: { status: 'active' }
        // Note: aggregateForTenant already prepends { $match: { clientId } }
        // so this $match only adds the status filter on top.
      },
      {
        $group: {
          _id:        null,
          totalValue: { $sum: { $multiply: ['$price', '$stockQuantity'] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        revenue: stats[0] || { totalRevenue: 0, totalTax: 0, totalOrders: 0, avgOrderValue: 0 },
        customers:      activeCustomers,
        inventoryValue: inventoryResult[0]?.totalValue || 0,
        dateRange:      { start, end }
      }
    });
  } catch (error) {
    const status = error.isSecurityError ? 403 : 500;
    res.status(status).json({ success: false, message: 'Failed to generate overview.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SALES OVER TIME (last 30 days)
// ─────────────────────────────────────────────────────────────────────────────
exports.getSalesOverTime = async (req, res) => {
  try {
    _ensureTenant(req);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const salesData = await Order.aggregateForTenant(req.clientId, [
      {
        $match: {
          'payment.status': 'paid',
          createdAt:        { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id:        { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue:    { $sum: '$totals.total' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({ success: true, data: salesData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to aggregate sales data' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOP PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────
exports.getTopProducts = async (req, res) => {
  try {
    _ensureTenant(req);
    const safeLimit = Math.min(parseInt(req.query.limit) || 5, 20);

    const topProducts = await Order.aggregateForTenant(req.clientId, [
      { $match: { 'payment.status': 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id:              '$items.product.id',
          name:             { $first: '$items.product.name' },
          unitsSold:        { $sum: '$items.quantity' },
          revenueGenerated: { $sum: '$items.subtotal' }
        }
      },
      { $sort: { unitsSold: -1 } },
      { $limit: safeLimit }
    ]);

    res.json({ success: true, data: topProducts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve product analytics.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOP CUSTOMERS
// ─────────────────────────────────────────────────────────────────────────────
exports.getTopCustomers = async (req, res) => {
  try {
    _ensureTenant(req);

    const topCustomers = await Order.aggregateForTenant(req.clientId, [
      { $match: { 'payment.status': 'paid' } },
      {
        $group: {
          _id:        '$customer.email',
          name:       { $first: '$customer.name' },
          totalSpent: { $sum: '$totals.total' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({ success: true, data: topCustomers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to aggregate customer data' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE CHART
// ─────────────────────────────────────────────────────────────────────────────
exports.getRevenueChart = async (req, res) => {
  try {
    _ensureTenant(req);
    // Cap at 90 days to prevent full-collection scans
    const days      = Math.min(parseInt(req.query.days) || 7, 90);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const chartData = await Order.aggregateForTenant(req.clientId, [
      {
        $match: {
          'payment.status': 'paid',
          createdAt:        { $gte: startDate }
        }
      },
      {
        $group: {
          _id:    { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totals.total' },
          orders:  { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({ success: true, data: chartData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate chart data.' });
  }
};
