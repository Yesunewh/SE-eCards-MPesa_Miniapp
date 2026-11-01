-- Wupex and the M-Pesa mini program.

-- The mini program login may not reveal the phone number (depends on the scopes M-Pesa grants),
-- so a customer can exist with only their M-Pesa id. They give an SMS number at checkout instead.
ALTER TABLE customers ALTER COLUMN msisdn DROP NOT NULL;
ALTER TABLE payments  ALTER COLUMN msisdn DROP NOT NULL;

-- mini program payments (payments/pay + my.tradePay) next to the older STK push
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('mpesa', 'mpesa_miniapp', 'mock'));

-- What the adapter recorded just before buying (e.g. Wupex: the newest order id seen), used to find
-- the order again after a timeout. Wupex accepts no reference of ours, so this is how a lost answer is recovered.
ALTER TABLE provider_orders ADD COLUMN request_context JSONB NOT NULL DEFAULT '{}'::jsonb;

-- A provider's order (e.g. Wupex orderName) can belong to one of our purchases only: never claimed twice.
CREATE UNIQUE INDEX provider_orders_external_uq ON provider_orders (provider_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- the provider's own price for each product, as it reports it (in the provider's currency, cents)
ALTER TABLE provider_products ADD COLUMN price_cents BIGINT;
