// constants/order.js
const SA_PAYMENT_METHODS = ['paystack', 'ozow', 'eftonline', 'bank_transfer', 'credit_card', 'debit_card'];
const SA_COURIERS = ['courier_guy', 'aramex', 'paxi', 'self_collection'];
const TIMELINE_CAP = 20;
const MAX_CART_LINE_ITEMS = 50;
const MAX_QUANTITY_PER_ITEM = 100;
const MAX_AGGREGATE_QUANTITY = 250;
const DEFAULT_SHIPPING_COST = 120;
const VAT_RATE = 0.15;

module.exports = {
  SA_PAYMENT_METHODS,
  SA_COURIERS,
  TIMELINE_CAP,
  MAX_CART_LINE_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  MAX_AGGREGATE_QUANTITY,
  DEFAULT_SHIPPING_COST,
  VAT_RATE
};