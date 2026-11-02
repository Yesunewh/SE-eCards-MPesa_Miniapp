-- Provider pre-orders (Wupex, June 2026 API): a purchase can deliver some codes now and the rest later.
-- 'partial' = a provider pre-order: the provider is still buying codes; any delivered so far are already stored.
ALTER TABLE provider_orders DROP CONSTRAINT IF EXISTS provider_orders_status_check;
ALTER TABLE provider_orders ADD CONSTRAINT provider_orders_status_check CHECK (status IN (
  'pending',     -- about to call / calling the provider
  'partial',     -- provider pre-order: the provider is still buying codes (some may have been delivered already)
  'succeeded',   -- every code received and stored (or the provider closed the order)
  'failed',      -- provider said no (no money left the wallet)
  'unknown'));   -- timeout / 5xx / not ready: must be checked with the provider before retrying

DROP INDEX IF EXISTS provider_orders_unknown_idx;
CREATE INDEX provider_orders_open_idx ON provider_orders(created_at) WHERE status IN ('pending','unknown','partial');
