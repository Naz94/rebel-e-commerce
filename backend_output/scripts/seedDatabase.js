/**
 * MASTER SEEDER - SA-OPTIMIZED
 * Seeds database with products for all 3 template stores:
 * 1. Aura & Stone (Luxury Fragrances)
 * 2. Urban Edge (Streetwear)
 * 3. Tech Pro (Tech/Components)
 *
 * FIX: Corrected field names to match Product.js schema:
 *   stock       → stockQuantity
 *   featured    → isFeatured
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Product = require('../models/Product');

// =====================
// TEMPLATE 1: AURA & STONE (Luxury Fragrances)
// =====================
const auraStoneProducts = [
  {
    clientId: 'store-aura-stone',
    sku: 'AUS-FR-001',
    name: 'Midnight Amber',
    description: 'A warm, sensual blend of amber and vanilla with subtle hints of sandalwood.',
    price: 1250,
    cost: 450,
    category: 'Fragrances',
    stockQuantity: 25,      // FIX: was 'stock'
    reorderLevel: 5,
    status: 'active',
    isFeatured: true,       // FIX: was 'featured'
    tags: ['amber', 'vanilla', 'evening']
  },
  {
    clientId: 'store-aura-stone',
    sku: 'AUS-FR-002',
    name: 'Desert Rose',
    description: 'A floral masterpiece featuring Bulgarian rose and Moroccan oud.',
    price: 1850,
    cost: 700,
    category: 'Fragrances',
    stockQuantity: 15,
    reorderLevel: 3,
    status: 'active',
    isFeatured: true,
    tags: ['rose', 'oud', 'floral']
  },
  {
    clientId: 'store-aura-stone',
    sku: 'AUS-FR-003',
    name: 'White Cedar',
    description: 'A crisp, woody fragrance with bergamot top notes and a warm cedar base.',
    price: 980,
    cost: 320,
    category: 'Fragrances',
    stockQuantity: 30,
    reorderLevel: 5,
    status: 'active',
    isFeatured: false,
    tags: ['cedar', 'bergamot', 'woody']
  }
];

// =====================
// TEMPLATE 2: URBAN EDGE (Streetwear)
// =====================
const urbanEdgeProducts = [
  {
    clientId: 'store-urban-edge',
    sku: 'UE-TSH-001',
    name: 'Oversized Graphic Tee',
    description: 'Heavyweight cotton tee with local street art print.',
    price: 450,
    cost: 120,
    category: 'Apparel',
    stockQuantity: 100,
    reorderLevel: 20,
    status: 'active',
    isFeatured: true,
    tags: ['streetwear', 'tee', 'cotton']
  },
  {
    clientId: 'store-urban-edge',
    sku: 'UE-HOD-001',
    name: 'Urban Pullover Hoodie',
    description: 'Fleece-lined hoodie with embroidered chest logo.',
    price: 750,
    cost: 240,
    category: 'Apparel',
    stockQuantity: 60,
    reorderLevel: 15,
    status: 'active',
    isFeatured: true,
    tags: ['streetwear', 'hoodie', 'fleece']
  },
  {
    clientId: 'store-urban-edge',
    sku: 'UE-CAP-001',
    name: 'Snapback Cap',
    description: '6-panel snapback with flat brim and embroidered logo.',
    price: 280,
    cost: 80,
    category: 'Accessories',
    stockQuantity: 80,
    reorderLevel: 20,
    status: 'active',
    isFeatured: false,
    tags: ['cap', 'accessories', 'streetwear']
  }
];

// =====================
// TEMPLATE 3: TECH PRO (Components)
// =====================
const techProProducts = [
  {
    clientId: 'store-tech-pro',
    sku: 'TP-GPU-001',
    name: 'RTX 4080 Super',
    description: 'High-performance graphics card for gaming and rendering.',
    price: 24500,
    cost: 19000,
    category: 'Hardware',
    stockQuantity: 10,
    reorderLevel: 2,
    status: 'active',
    isFeatured: true,
    tags: ['gpu', 'nvidia', 'gaming']
  },
  {
    clientId: 'store-tech-pro',
    sku: 'TP-RAM-001',
    name: 'DDR5 32GB Kit (2x16)',
    description: '6000MHz DDR5 memory kit with RGB lighting.',
    price: 3200,
    cost: 2100,
    category: 'Memory',
    stockQuantity: 25,
    reorderLevel: 5,
    status: 'active',
    isFeatured: false,
    tags: ['ram', 'ddr5', 'memory']
  },
  {
    clientId: 'store-tech-pro',
    sku: 'TP-SSD-001',
    name: '2TB NVMe M.2 SSD',
    description: 'PCIe 4.0 NVMe SSD with 7000MB/s read speeds.',
    price: 1850,
    cost: 1200,
    category: 'Storage',
    stockQuantity: 40,
    reorderLevel: 8,
    status: 'active',
    isFeatured: false,
    tags: ['ssd', 'nvme', 'storage']
  }
];

// =====================
// SEEDING LOGIC
// =====================

async function seedTemplate(name, clientId, products) {
  try {
    await Product.deleteMany({ clientId });
    const inserted = await Product.insertMany(products);
    console.log(`✅ ${name}: Seeded ${inserted.length} products.`);
    return inserted.length;
  } catch (error) {
    console.error(`❌ Error seeding ${name}:`, error.message);
    return 0;
  }
}

async function clearAllProducts() {
  await Product.deleteMany({});
  console.log('🗑️  All products cleared from database.');
}

async function runSeeder() {
  const command = process.argv[2];
  let totalSeeded = 0;

  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not found in .env file');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('CONNECTED TO DATABASE:', mongoose.connection.name);
    console.log('═'.repeat(50));

    if (!command || command === 'all') {
      totalSeeded += await seedTemplate('Aura & Stone', 'store-aura-stone', auraStoneProducts);
      totalSeeded += await seedTemplate('Urban Edge', 'store-urban-edge', urbanEdgeProducts);
      totalSeeded += await seedTemplate('Tech Pro', 'store-tech-pro', techProProducts);
    } else if (command === 'aura') {
      totalSeeded += await seedTemplate('Aura & Stone', 'store-aura-stone', auraStoneProducts);
    } else if (command === 'streetwear') {
      totalSeeded += await seedTemplate('Urban Edge', 'store-urban-edge', urbanEdgeProducts);
    } else if (command === 'tech') {
      totalSeeded += await seedTemplate('Tech Pro', 'store-tech-pro', techProProducts);
    } else if (command === 'clear') {
      await clearAllProducts();
    } else {
      console.log('❌ Unknown command. Use: aura, streetwear, tech, clear, or all');
    }

    console.log('═'.repeat(50));
    console.log(`\n🎉 Process Complete. Total products seeded: ${totalSeeded}\n`);

  } catch (err) {
    console.error('❌ CRITICAL ERROR:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

runSeeder();