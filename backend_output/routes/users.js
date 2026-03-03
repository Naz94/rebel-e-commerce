const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, staffOnly, checkPermission } = require('../middleware/auth');

// Get all users (Scoped by clientId)
router.get('/', protect, staffOnly, checkPermission('users', 'view'), async (req, res) => {
  try {
    const users = await User.find({ clientId: req.clientId }).select('-password -resetPasswordToken -emailVerificationToken');
    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create user
router.post('/', protect, staffOnly, checkPermission('users', 'create'), async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    // FIX: Whitelist fields — do NOT spread req.body which allows role/clientId injection
    const user = await User.create({
      email,
      password,
      firstName,
      lastName,
      phone,
      clientId: req.clientId, // Always derive from middleware, never from body
      role: 'staff'           // New users created via this route are always staff
    });

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({ success: true, data: userResponse });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update user (Scoped by clientId)
router.put('/:id', protect, staffOnly, checkPermission('users', 'edit'), async (req, res) => {
  try {
    // FIX: Whitelist allowed update fields — prevents clientId/role injection via req.body
    const { firstName, lastName, phone, permissions, status } = req.body;
    const allowedUpdates = {};
    if (firstName !== undefined) allowedUpdates.firstName = firstName;
    if (lastName !== undefined) allowedUpdates.lastName = lastName;
    if (phone !== undefined) allowedUpdates.phone = phone;
    if (permissions !== undefined) allowedUpdates.permissions = permissions;
    // Only owner can change status
    if (status !== undefined && req.user?.role === 'owner') allowedUpdates.status = status;

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, clientId: req.clientId },
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    ).select('-password -resetPasswordToken -emailVerificationToken');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete user (Scoped by clientId)
router.delete('/:id', protect, staffOnly, checkPermission('users', 'delete'), async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    const user = await User.findOneAndDelete({
      _id: req.params.id,
      clientId: req.clientId
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;