const Customer = require('../models/Customer');

/**
 * @desc    Get all customers with ReDoS protection and pagination caps
 * @route   GET /api/customers
 */
exports.getAllCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    // FIX 1: Enforce a hard ceiling on pagination to prevent memory exhaustion
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const query = { clientId: req.clientId };

    if (search) {
      // FIX 2: Escape regex special characters to prevent Catastrophic Backtracking (ReDoS)
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      query.$or = [
        { email: { $regex: escapedSearch, $options: 'i' } },
        { firstName: { $regex: escapedSearch, $options: 'i' } },
        { lastName: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (status) {
      query.accountStatus = status;
    }

    const customers = await Customer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit);

    const total = await Customer.countDocuments(query);

    res.json({
      success: true,
      count: customers.length,
      total,
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit)
      },
      data: customers
    });
  } catch (error) {
    console.error('Get Customers Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve customers'
    });
  }
};

/**
 * @desc    Get single customer (Tenant Scoped)
 */
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      clientId: req.clientId
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Retrieval error' });
  }
};

/**
 * @desc    Update customer with Mass Assignment Protection
 */
exports.updateCustomer = async (req, res) => {
  try {
    const { firstName, lastName, phone, email, addresses, tags, notes, marketing } = req.body;

    // Tenant isolation remains strong here
    let customer = await Customer.findOne({
      _id: req.params.id,
      clientId: req.clientId
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Update fields only if provided
    if (firstName) customer.firstName = firstName;
    if (lastName) customer.lastName = lastName;
    if (phone) customer.phone = phone;
    if (email) customer.email = email;
    if (addresses) customer.addresses = addresses;
    if (tags) customer.tags = tags;
    if (notes) customer.notes = notes;
    if (marketing) customer.marketing = marketing;

    await customer.save();

    res.json({ success: true, data: customer });
  } catch (error) {
    const isValidationError = error.name === 'ValidationError';
    res.status(400).json({ 
      success: false, 
      message: isValidationError ? error.message : 'Update failed' 
    });
  }
};

/**
 * @desc    Soft Delete Customer
 */
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      clientId: req.clientId
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    customer.accountStatus = 'deleted';
    await customer.save();

    res.json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Deletion failed' });
  }
};

/**
 * @desc    Customer stats (Tenant Scoped)
 */
exports.getCustomerStats = async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments({
      clientId: req.clientId,
      accountStatus: 'active'
    });

    const newThisMonth = await Customer.countDocuments({
      clientId: req.clientId,
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    });

    res.json({
      success: true,
      data: {
        totalCustomers,
        newThisMonth
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Stats retrieval failed' });
  }
};