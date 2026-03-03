process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../server'); 
const Order = require('../models/Order');
const Client = require('../models/Client');
const crypto = require('crypto');

describe('Payment Webhook Handlers', () => {
  let mockOrder, mockClient, privateKey;

  beforeEach(async () => {
    privateKey = 'test_private_key';
    
    mockClient = {
      clientId: 'store_123',
      paymentGateways: {
        ozow: { enabled: true, privateKey: privateKey },
        zapper: { enabled: true, apiKey: 'zapper_secret_api_key' }
      }
    };
    jest.spyOn(Client, 'findOne').mockResolvedValue(mockClient);

    mockOrder = {
      _id: '65d43210abcde12345678901',
      orderNumber: 'ORD-999',
      clientId: 'store_123',
      pricing: { total: 15000 },
      payment: { status: 'pending' },
      markAsPaid: jest.fn().mockResolvedValue(true)
    };
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Order, 'findOne').mockResolvedValue(mockOrder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/payments/ozow/webhook', () => {
    it('should successfully process a valid Ozow webhook and mark order as paid', async () => {
      const payload = {
        TransactionId: 'TXN-001',
        TransactionReference: 'ORD-999',
        CurrencyCode: 'ZAR',
        Amount: '150.00',
        Status: 'Complete',
        Optional1: mockOrder._id.toString()
      };

      const checkString = (payload.TransactionId + payload.TransactionReference + payload.CurrencyCode + payload.Amount + payload.Status + payload.Optional1).toLowerCase();
      const validHash = crypto.createHash('sha512').update(checkString + privateKey.toLowerCase()).digest('hex');
      
      const response = await request(app)
        .post('/api/v1/payments/ozow/webhook')
        .send({ ...payload, CheckSum: validHash });

      expect(response.status).toBe(200);
      expect(mockOrder.markAsPaid).toHaveBeenCalledWith('OZOW_WEBHOOK', 15000, 'instant_eft');
    });

    it('should correctly handle falsy but defined fields in hash calculation (the "0" bug)', async () => {
      const payload = {
        TransactionId: 'TXN-001',
        Status: 'Complete',
        Optional1: mockOrder._id.toString(),
        Optional2: "0" 
      };

      const checkString = (payload.TransactionId + payload.Status + payload.Optional1 + payload.Optional2).toLowerCase();
      const validHash = crypto.createHash('sha512').update(checkString + privateKey.toLowerCase()).digest('hex');

      const response = await request(app)
        .post('/api/v1/payments/ozow/webhook')
        .send({ ...payload, CheckSum: validHash });

      expect(response.status).toBe(200);
      expect(mockOrder.markAsPaid).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/payments/zapper/webhook', () => {
    it('should verify Zapper signature correctly', async () => {
      const data = { reference: 'ORD-999', amount: 150.00 };
      const signature = crypto.createHmac('sha256', 'zapper_secret_api_key')
        .update(JSON.stringify(data))
        .digest('hex');

      const response = await request(app)
        .post('/api/v1/payments/zapper/webhook')
        .send({ data, signature });

      expect(response.status).toBe(200);
      expect(mockOrder.markAsPaid).toHaveBeenCalled();
    });
  });
});