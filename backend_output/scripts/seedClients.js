const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Client = require('../models/Client');

const clients = [
  {
    clientId: 'store-aura-stone',
    businessName: 'Aura & Stone',
    subdomain: 'aura-stone',
    design: { themeId: 'luxury' },
    tier: 'starter',
    settings: { currency: 'ZAR', timezone: 'Africa/Johannesburg' }
  },
  {
    clientId: 'store-urban-edge',
    businessName: 'Urban Edge',
    subdomain: 'urban-edge',
    design: { themeId: 'modern' },
    tier: 'starter',
    settings: { currency: 'ZAR', timezone: 'Africa/Johannesburg' }
  },
  {
    clientId: 'store-tech-pro',
    businessName: 'Tech Pro',
    subdomain: 'tech-pro',
    design: { themeId: 'minimal' },
    tier: 'starter',
    settings: { currency: 'ZAR', timezone: 'Africa/Johannesburg' }
  }
];

const run = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing from your .env file');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    for (const clientData of clients) {
      const existing = await Client.findOne({ clientId: clientData.clientId });
      if (existing) {
        console.log(`Client ${clientData.clientId} already exists, skipping`);
        continue;
      }
      await Client.create(clientData);
      console.log(`Created client: ${clientData.businessName}`);
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
};

run();