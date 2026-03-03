process.env.NODE_ENV = 'test';

const request = require('supertest');
const crypto = require('crypto');
const app = require('../server'); 
const Order = require('../models/Order');
const Client = require('../models/Client');

describe('Payment Webhook Verification', () => {
  let mockOrder, mockClient, testKey;

  beforeEach(() => {
    testKey = 'super_secret_ozow_key';
    
    mockClient = {
      clientId: 'store_123',
      paymentGateways: {
        ozow: { enabled: true, privateKey: testKey }
      }
    };

    mockOrder = {
      _id: '65d43210abcde12345678901',
      orderNumber: 'ORD-TEST-001',
      clientId: 'store_123',
      pricing: { total: 5000 },
      payment: { status: 'pending' },
      markAsPaid: jest.fn().mockResolvedValue(true)
    };

    jest.spyOn(Client, 'findOne').mockResolvedValue(mockClient);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Order, 'findOne').mockResolvedValue(mockOrder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should verify valid Ozow signature and update order status', async () => {
    const payload = {
      TransactionId: 'TXN-1',
      TransactionReference: 'ORD-TEST-001',
      CurrencyCode: 'ZAR',
      Amount: '50.00',
      Status: 'Complete',
      Optional1: mockOrder._id.toString()
    };

    const checkString = (
        payload.TransactionId + payload.TransactionReference + payload.CurrencyCode + 
        payload.Amount + payload.Status + payload.Optional1
    ).toLowerCase();
    
    const checkSum = crypto.createHash('sha512').update(checkString + testKey.toLowerCase()).digest('hex');

    const res = await request(app)
      .post('/api/v1/payments/ozow/webhook')
      .send({ ...payload, CheckSum: checkSum });

    expect(res.status).toBe(200);
    expect(mockOrder.markAsPaid).toHaveBeenCalled();
  });
});