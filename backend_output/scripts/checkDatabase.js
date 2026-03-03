/**
 * checkDatabase.js — Dev/admin diagnostic script
 * FIX: Added clientId to all queries to respect tenant isolation.
 * FIX: Updated clientId references to match seedDatabase.js client IDs.
 * FIX: Uses direct mongoose connection to bypass model tenant firewalls.
 */

const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Product = require('../models/Product');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/merchant-hub';

const CLIENT_IDS = [
  'store-aura-stone',
  'store-urban-edge',
  'store-tech-pro'
];

async function checkDatabase() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Total count — requires a raw collection call since Product model
    // doesn't have a tenant firewall but it's good practice to scope queries
    const totalCount = await Product.collection.countDocuments();
    console.log(`📊 Total products in database: ${totalCount}\n`);

    // Check each known client
    for (const clientId of CLIENT_IDS) {
      const products = await Product.find({ clientId });
      console.log(`🏪 [${clientId}] — ${products.length} product(s)`);

      if (products.length > 0) {
        products.forEach(p => {
          console.log(`   - ${p.name} (SKU: ${p.sku}, Price: R${p.price}, Stock: ${p.stockQuantity})`);
        });
      }
      console.log('');
    }

    // Show all unique clientIds present in the collection
    const clientIds = await Product.collection.distinct('clientId');
    console.log('🔍 All clientIds in database:', clientIds);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

checkDatabase();