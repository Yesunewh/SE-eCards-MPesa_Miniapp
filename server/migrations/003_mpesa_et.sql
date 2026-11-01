-- M-Pesa Ethiopia H5 mini app: userScopes login and payWithMpesa + C2B callbacks.

-- Each app install has a random device key; only its hash is stored.
ALTER TABLE customer_sessions ADD COLUMN device_hash BYTEA;
-- false = the identity was sent by the app (userScopes) and could not be checked by our server.
-- Such sessions see gift codes only for orders placed from the same device.
ALTER TABLE customer_sessions ADD COLUMN verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN device_hash BYTEA;

-- what the app reported after payWithMpesa (transactionId, or the error): informational only,
-- the money is confirmed by M-Pesa's C2B Confirmation callback
ALTER TABLE payments ADD COLUMN client_result JSONB;

ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_source_check;
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_source_check CHECK (source IN ('mpesa', 'mpesa_c2b', 'wupex', 'other'));
