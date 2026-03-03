// tests/setup.js
const mongoose = require('mongoose');

// Prevent Mongoose from actually connecting to anything
jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return {
    ...actualMongoose,
    connect: jest.fn().mockResolvedValue(true),
    connection: {
      on: jest.fn(),
      once: jest.fn(),
    },
  };
});