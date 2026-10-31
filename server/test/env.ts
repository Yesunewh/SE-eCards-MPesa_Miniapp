// Test configuration: a separate database and throwaway keys.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ecards:ecards@localhost:5432/ecards_test';
process.env.CODE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.CODE_HMAC_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.MPESA_CALLBACK_SECRET = 'test-callback-secret-0123456789';
process.env.PAYMENTS_ADAPTER = 'mock';
process.env.GIFTCARD_ADAPTER = 'mock';
