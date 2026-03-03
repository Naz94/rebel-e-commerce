const Client = require('../models/Client');

/**
 * @desc    Get store settings
 * @route   GET /api/settings
 */
exports.getSettings = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId });
    if (!client) return res.status(404).json({ message: 'Store not found' });
    res.json({ success: true, data: client.settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Retrieval failed' });
  }
};

/**
 * @desc    Update store-specific settings
 * @route   PUT /api/settings/store
 */
exports.updateStoreSettings = async (req, res) => {
  try {
    const { storeName, taxRate, currency } = req.body;

    // FIX: findOneAndUpdate with clientId string. 
    // FIX: taxRate clamped to 30% to prevent calculation corruption.
    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId }, 
      { 
        $set: { 
          'settings.storeName': storeName,
          'settings.taxRate': Math.max(0, Math.min(taxRate || 0, 0.30)),
          'settings.currency': currency || 'ZAR'
        } 
      },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: 'Store configuration not found' });
    }

    res.json({ success: true, data: client.settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

/**
 * @desc    Update branding (Logo, Colors)
 * @route   PUT /api/settings/branding
 */
exports.updateBranding = async (req, res) => {
  try {
    const { logo, primaryColor } = req.body;

    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId },
      { 
        $set: { 
          'branding.logo': logo, 
          'branding.primaryColor': primaryColor || '#000000' 
        } 
      },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client configuration not found' });
    }

    res.json({ success: true, data: client.branding });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Branding update failed' });
  }
};

/**
 * @desc    Update contact information
 * @route   PUT /api/settings/contact
 */
exports.updateContact = async (req, res) => {
  try {
    const { email, phone, address } = req.body;

    const client = await Client.findOneAndUpdate(
      { clientId: req.clientId },
      { 
        $set: { 
          'contact.email': email,
          'contact.phone': phone,
          'contact.address': address
        } 
      },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: 'Contact configuration not found' });
    }

    res.json({ success: true, data: client.contact });
  } catch (error) {
    const isValidationError = error.name === 'ValidationError';
    res.status(400).json({ 
      success: false, 
      message: isValidationError ? error.message : 'Update failed' 
    });
  }
};

/**
 * @desc    Get client tier info
 * @route   GET /api/settings/tier
 */
exports.getTierInfo = async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.clientId })
      .select('tier settings.featureFlags -_id');

    if (!client) return res.status(404).json({ message: 'Tier info not found' });
    res.json({ success: true, data: client });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Retrieval failed' });
  }
};
