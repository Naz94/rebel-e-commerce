/**
 * makeOwner.js — Utility script to promote a user to 'owner' role.
 *
 * FIX: Removed hardcoded email/clientId. Now accepts CLI arguments so this
 * script works for any tenant, not just the original test store.
 *
 * Usage:
 *   node scripts/makeOwner.js <email> <clientId>
 *   node scripts/makeOwner.js admin@mystore.com store-my-store
 */

const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

const run = async () => {
  const email = process.argv[2];
  const clientId = process.argv[3];

  if (!email || !clientId) {
    console.error('❌ Usage: node scripts/makeOwner.js <email> <clientId>');
    console.error('   Example: node scripts/makeOwner.js admin@mystore.com store-my-store');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const user = await User.findOneAndUpdate(
      { email, clientId },
      { role: 'owner' },
      { new: true }
    );

    if (!user) {
      console.error(`❌ No user found with email "${email}" in clientId "${clientId}"`);
      process.exit(1);
    }

    console.log(`✅ Updated: ${user.email} (${user.clientId}) is now role: ${user.role}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

run();