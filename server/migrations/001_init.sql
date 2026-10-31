-- eCards M-Pesa mini app: initial schema (PostgreSQL 14+)
--
-- Conventions
--   * Money in Ethiopian Birr is stored as BIGINT santim (1 Br = 100 santim) in *_minor columns.
--   * Gift card face values and provider costs are USD cents (INTEGER / BIGINT *_usd_cents).
--   * Exchange rates and VAT are NUMERIC, snapshotted on every order so history never changes.
--   * Status columns are TEXT + CHECK (easier to extend in a later migration than PG enums).
--   * Gift card codes are never stored in clear text: AES-256-GCM ciphertext + an HMAC for uniqueness.
--   * Every table has created_at; mutable tables also have updated_at maintained by a trigger.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- People
-- =====================================================================

-- Customers come from M-Pesa: the mini app login gives us an M-Pesa user id, name and phone number.
CREATE TABLE customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mpesa_user_id    TEXT UNIQUE,                       -- id/openId returned by the M-Pesa mini app auth
  msisdn           TEXT NOT NULL UNIQUE               -- E.164 without spaces, e.g. +251712345678
                   CHECK (msisdn ~ '^\+251[79][0-9]{8}$'),
  name             TEXT NOT NULL DEFAULT '',
  lang             TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','am','om','so','ti')),
  -- where codes are sent: an email address, or a phone number by SMS
  deliver_by       TEXT NOT NULL DEFAULT 'sms' CHECK (deliver_by IN ('email','sms')),
  deliver_email    TEXT,
  deliver_msisdn   TEXT CHECK (deliver_msisdn IS NULL OR deliver_msisdn ~ '^\+251[79][0-9]{8}$'),
  is_blocked       BOOLEAN NOT NULL DEFAULT false,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Opaque bearer tokens; only the SHA-256 of the token is stored.
CREATE TABLE customer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash    BYTEA NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  user_agent    TEXT,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(customer_id);

CREATE TABLE admin_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,                     -- scrypt$N$r$p$salt$hash
  role            TEXT NOT NULL DEFAULT 'support'
                  CHECK (role IN ('owner','admin','support','viewer')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_uq ON admin_users (lower(email));
CREATE TRIGGER admin_users_updated BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     BYTEA NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  ip             INET,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions(admin_user_id);

-- =====================================================================
-- Settings and catalog
-- =====================================================================

-- One row. Mirrors defaultConfig() in index.html / admin.html.
CREATE TABLE app_settings (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  usd_etb_rate          NUMERIC(12,4) NOT NULL CHECK (usd_etb_rate > 0),   -- Birr per 1 USD of face value
  vat_rate              NUMERIC(6,4)  NOT NULL CHECK (vat_rate >= 0 AND vat_rate < 1),  -- 0.15, included in prices
  seller_name           TEXT NOT NULL DEFAULT 'eCards',
  low_stock_threshold   INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  auto_fulfil           BOOLEAN NOT NULL DEFAULT true,    -- deliver waiting pre-orders as soon as stock arrives
  max_qty_per_line      INTEGER NOT NULL DEFAULT 10 CHECK (max_qty_per_line > 0),
  max_order_total_minor BIGINT  NOT NULL DEFAULT 50000000 CHECK (max_order_total_minor > 0), -- Br 500,000
  payment_timeout_secs  INTEGER NOT NULL DEFAULT 900 CHECK (payment_timeout_secs > 0),
  default_restock_days  INTEGER NOT NULL DEFAULT 3 CHECK (default_restock_days >= 1),
  support               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {phone,email,telegram,whatsapp,from,to}
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID REFERENCES admin_users(id)
);
CREATE TRIGGER app_settings_updated BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE brands (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),   -- 'netflix', 'playstation'
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  label           TEXT CHECK (label IS NULL OR length(label) <= 24),   -- short name on tiles
  mark            TEXT NOT NULL CHECK (length(mark) BETWEEN 1 AND 24), -- word mark drawn on the card
  category        TEXT NOT NULL CHECK (category IN ('gaming','apps','video','music','telecom','card')),
  -- colours used by the app (see BRANDS in index.html); style holds the remaining design knobs
  color1          TEXT NOT NULL CHECK (color1 ~ '^#[0-9a-fA-F]{6}$'),
  color2          TEXT NOT NULL CHECK (color2 ~ '^#[0-9a-fA-F]{6}$'),
  ink             TEXT NOT NULL CHECK (ink ~ '^#[0-9a-fA-F]{6}$'),
  tile            TEXT NOT NULL CHECK (tile ~ '^#[0-9a-fA-F]{6}$'),
  tile_ink        TEXT NOT NULL CHECK (tile_ink ~ '^#[0-9a-fA-F]{6}$'),
  style           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {light, band, ms, ls, fw}
  logo_url        TEXT,
  card_image_url  TEXT,
  banner_url      TEXT,
  description     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per language: {"en": "...", "am": "..."}
  redeem_info     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- per language: how to redeem
  is_active       BOOLEAN NOT NULL DEFAULT true,        -- false = not sold, hidden from the app
  is_hidden       BOOLEAN NOT NULL DEFAULT false,       -- house brand used only for artwork ('ecards')
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER brands_updated BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A sellable card: one brand at one USD face value. Region is always Ethiopia-facing for now.
CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            TEXT NOT NULL REFERENCES brands(id) ON UPDATE CASCADE,
  face_value_cents    INTEGER NOT NULL CHECK (face_value_cents > 0),     -- 5000 = $50
  face_currency       CHAR(3) NOT NULL DEFAULT 'USD',
  region              CHAR(3) NOT NULL DEFAULT 'ETH',
  price_override_minor BIGINT CHECK (price_override_minor IS NULL OR price_override_minor > 0), -- fixed Birr price instead of rate x face
  is_active           BOOLEAN NOT NULL DEFAULT true,
  restock_eta         DATE,                                              -- shown to customers while out of stock
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, face_value_cents, face_currency, region)
);
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Home screen: banners, popular brands and product rows (cfg.banners / cfg.popular / ROWS0)
CREATE TABLE home_banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    TEXT NOT NULL REFERENCES brands(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title       TEXT CHECK (title IS NULL OR length(title) <= 30),
  accent      TEXT CHECK (accent IS NULL OR accent ~ '^#[0-9a-fA-F]{6}$'),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id)
);

CREATE TABLE home_popular_brands (
  brand_id  TEXT PRIMARY KEY REFERENCES brands(id) ON UPDATE CASCADE ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE home_row_items (
  row_key     TEXT NOT NULL CHECK (row_key IN ('rowTop','rowGaming','rowStreaming')),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (row_key, product_id)
);

-- =====================================================================
-- Gift card providers (Wupex first; Reloadly / others use the same tables)
-- =====================================================================

CREATE TABLE providers (
  id                  TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),   -- 'wupex'
  name                TEXT NOT NULL,
  adapter             TEXT NOT NULL CHECK (adapter IN ('wupex','reloadly','mock')),
  environment         TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  base_url            TEXT,
  -- secrets are NOT stored here: config names the env vars that hold them, e.g. {"apiKeyEnv":"WUPEX_API_KEY"}
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active           BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','ok','error')),
  status_message      TEXT,
  balance_cents       BIGINT,                         -- prepaid wallet balance, in balance_currency
  balance_currency    CHAR(3) NOT NULL DEFAULT 'USD',
  balance_checked_at  TIMESTAMPTZ,
  low_balance_cents   BIGINT NOT NULL DEFAULT 0,
  buy_rate            NUMERIC(12,4),                   -- Birr paid per 1 USD of provider balance (for margins)
  priority            INTEGER NOT NULL DEFAULT 100,    -- lower = tried first
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER providers_updated BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The provider's own catalog, refreshed by a sync job.
CREATE TABLE provider_products (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id        TEXT NOT NULL,
  name               TEXT NOT NULL,
  brand_name         TEXT,
  country            TEXT,
  currency           CHAR(3) NOT NULL DEFAULT 'USD',
  denomination_type  TEXT NOT NULL DEFAULT 'FIXED' CHECK (denomination_type IN ('FIXED','RANGE')),
  denominations_cents INTEGER[] NOT NULL DEFAULT '{}',
  min_cents          INTEGER,
  max_cents          INTEGER,
  discount_pct       NUMERIC(6,3),
  fee_cents          INTEGER,
  is_available       BOOLEAN NOT NULL DEFAULT true,
  raw                JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_id)
);

-- Which provider product delivers which of our products (cfg "sell" mapping), with failover order.
CREATE TABLE product_sources (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider_id          TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_product_id  UUID REFERENCES provider_products(id) ON DELETE SET NULL,
  external_product_id  TEXT NOT NULL,                    -- what we send to the provider
  unit_cost_cents      BIGINT NOT NULL CHECK (unit_cost_cents >= 0),  -- what one card costs us, in USD cents
  priority             INTEGER NOT NULL DEFAULT 100,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, provider_id)
);
CREATE TRIGGER product_sources_updated BEFORE UPDATE ON product_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Stock: gift card codes we hold (uploaded by admins, or received from a provider)
-- =====================================================================

CREATE TABLE inventory_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id),
  source        TEXT NOT NULL CHECK (source IN ('upload','provider')),
  supplier      TEXT,
  code_count    INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents BIGINT,
  note          TEXT,
  created_by    UUID REFERENCES admin_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           TEXT NOT NULL UNIQUE CHECK (reference ~ '^EC[0-9]{8}$'),  -- shown to customers
  customer_id         UUID NOT NULL REFERENCES customers(id),
  status              TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                        'pending_payment',   -- created, waiting for M-Pesa
                        'paid',              -- payment confirmed, fulfilment queued / running
                        'awaiting_stock',    -- paid, some cards are pre-orders waiting for stock
                        'completed',         -- every card delivered
                        'payment_failed',    -- M-Pesa declined / cancelled by customer
                        'expired',           -- not paid in time
                        'cancelled')),       -- cancelled before payment
  currency            CHAR(3) NOT NULL DEFAULT 'ETB',
  subtotal_minor      BIGINT NOT NULL CHECK (subtotal_minor >= 0),   -- price before VAT
  vat_minor           BIGINT NOT NULL CHECK (vat_minor >= 0),
  total_minor         BIGINT NOT NULL CHECK (total_minor > 0),       -- what the customer pays
  usd_etb_rate        NUMERIC(12,4) NOT NULL,                        -- snapshot
  vat_rate            NUMERIC(6,4) NOT NULL,                         -- snapshot
  deliver_by          TEXT NOT NULL CHECK (deliver_by IN ('email','sms')),
  deliver_to          TEXT NOT NULL,                                 -- email or +251… number
  lang                TEXT NOT NULL DEFAULT 'en',
  channel             TEXT NOT NULL DEFAULT 'miniapp' CHECK (channel IN ('miniapp','web','admin')),
  idempotency_key     TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  paid_at             TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (subtotal_minor + vat_minor = total_minor),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX orders_customer_idx ON orders(customer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders(status, created_at);
CREATE INDEX orders_pending_expiry_idx ON orders(expires_at) WHERE status = 'pending_payment';
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no             SMALLINT NOT NULL CHECK (line_no > 0),
  product_id          UUID NOT NULL REFERENCES products(id),
  brand_id            TEXT NOT NULL,                     -- snapshot
  title               TEXT NOT NULL,                     -- snapshot, "Netflix 50 USD"
  face_value_cents    INTEGER NOT NULL,                  -- snapshot
  quantity            INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_minor    BIGINT NOT NULL CHECK (unit_price_minor > 0),   -- VAT included
  line_total_minor    BIGINT NOT NULL,
  delivered_quantity  INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending',     -- order not paid yet
                        'waiting',     -- paid; pre-order, some or all cards still to deliver
                        'delivered',   -- every card delivered
                        'cancelled')),
  eta                 DATE,                              -- promised date while waiting
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_no),
  CHECK (line_total_minor = unit_price_minor * quantity),
  CHECK (delivered_quantity BETWEEN 0 AND quantity),
  CHECK (status <> 'delivered' OR delivered_quantity = quantity)
);
CREATE INDEX order_items_waiting_idx ON order_items(product_id, created_at) WHERE status = 'waiting';
CREATE TRIGGER order_items_updated BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE gift_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID NOT NULL REFERENCES products(id),
  batch_id              UUID REFERENCES inventory_batches(id),
  source                TEXT NOT NULL CHECK (source IN ('upload','provider')),
  provider_order_id     UUID,                                   -- FK added below
  -- encrypted with AES-256-GCM: iv(12) || tag(16) || ciphertext. key_version allows key rotation.
  code_enc              BYTEA NOT NULL,
  pin_enc               BYTEA,
  serial                TEXT,
  key_version           SMALLINT NOT NULL DEFAULT 1,
  code_hmac             BYTEA NOT NULL UNIQUE,                  -- HMAC-SHA256(code): blocks duplicate uploads
  code_last4            TEXT NOT NULL,                          -- for admin screens and support
  expires_on            DATE,
  unit_cost_cents       BIGINT,
  status                TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','void')),
  order_item_id         UUID REFERENCES order_items(id),
  sold_at               TIMESTAMPTZ,
  customer_used_at      TIMESTAMPTZ,                            -- customer ticked "I used this code"
  voided_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'sold') = (order_item_id IS NOT NULL))
);
-- Allocation picks the oldest available code per product: FOR UPDATE SKIP LOCKED on this index.
CREATE INDEX gift_codes_available_idx ON gift_codes(product_id, created_at) WHERE status = 'available';
CREATE INDEX gift_codes_order_item_idx ON gift_codes(order_item_id);

-- =====================================================================
-- Payments (M-Pesa)
-- =====================================================================

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES orders(id),
  method                TEXT NOT NULL DEFAULT 'mpesa' CHECK (method IN ('mpesa','mock')),
  status                TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN (
                          'initiated',   -- row created, request not yet accepted by M-Pesa
                          'pending',     -- M-Pesa accepted the request, waiting for the customer's PIN
                          'succeeded', 'failed', 'cancelled', 'timeout')),
  amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
  currency              CHAR(3) NOT NULL DEFAULT 'ETB',
  msisdn                TEXT NOT NULL,
  merchant_request_id   TEXT,
  checkout_request_id   TEXT UNIQUE,                 -- M-Pesa's id for the request; matches the callback
  receipt_number        TEXT UNIQUE,                 -- M-Pesa transaction id (e.g. "SAK1XYZ123")
  result_code           TEXT,
  result_desc           TEXT,
  request_payload       JSONB,
  callback_payload      JSONB,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments(order_id);
-- at most one successful payment per order
CREATE UNIQUE INDEX payments_one_success_uq ON payments(order_id) WHERE status = 'succeeded';
-- at most one in-flight payment per order
CREATE UNIQUE INDEX payments_one_open_uq ON payments(order_id) WHERE status IN ('initiated','pending');
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every inbound callback, stored before processing (audit + replay + dedupe).
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL CHECK (source IN ('mpesa','wupex','other')),
  external_id     TEXT,
  payload         JSONB NOT NULL,
  headers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified        BOOLEAN NOT NULL DEFAULT false,
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_lookup_idx ON webhook_events(source, external_id);

-- =====================================================================
-- Fulfilment through a provider
-- =====================================================================

CREATE TABLE provider_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id         UUID NOT NULL REFERENCES order_items(id),
  provider_id           TEXT NOT NULL REFERENCES providers(id),
  external_product_id   TEXT NOT NULL,
  custom_identifier     TEXT NOT NULL UNIQUE,          -- our idempotency key sent to the provider
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents       BIGINT,
  total_cost_cents      BIGINT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending',     -- about to call / calling the provider
                          'succeeded',   -- codes received and stored
                          'failed',      -- provider said no (no money left the wallet)
                          'unknown')),   -- timeout / 5xx: must be checked with the provider before retrying
  external_transaction_id TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  response_summary      JSONB,                          -- never contains codes
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_orders_item_idx ON provider_orders(order_item_id);
CREATE INDEX provider_orders_unknown_idx ON provider_orders(created_at) WHERE status IN ('pending','unknown');
CREATE TRIGGER provider_orders_updated BEFORE UPDATE ON provider_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE gift_codes ADD CONSTRAINT gift_codes_provider_order_fk
  FOREIGN KEY (provider_order_id) REFERENCES provider_orders(id);

-- Outbound provider HTTP calls (the admin "API log"). Codes are never written here.
CREATE TABLE provider_api_calls (
  id            BIGSERIAL PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  http_status   INTEGER,
  duration_ms   INTEGER,
  ok            BOOLEAN NOT NULL,
  note          TEXT,
  ref           TEXT,                       -- order reference / custom identifier
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_api_calls_recent_idx ON provider_api_calls(provider_id, created_at DESC);

-- =====================================================================
-- Delivering codes to the customer (email / SMS), and other messages
-- =====================================================================

CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID REFERENCES customers(id),
  order_id            UUID REFERENCES orders(id),
  channel             TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient           TEXT NOT NULL,
  template            TEXT NOT NULL,             -- 'codes_delivered', 'preorder_waiting', 'support_reply' …
  params              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- never contains codes; renderer loads them
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error          TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_order_idx ON notifications(order_id);
CREATE TRIGGER notifications_updated BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Customer extras
-- =====================================================================

CREATE TABLE wishlist_items (
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  was_out_of_stock BOOLEAN NOT NULL DEFAULT false,
  notified_at   TIMESTAMPTZ,                       -- back-in-stock message sent
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TABLE support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT NOT NULL UNIQUE CHECK (reference ~ '^T[0-9]{6}$'),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  order_id          UUID REFERENCES orders(id),
  topic             TEXT NOT NULL CHECK (topic IN ('order','payment','pre','other')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  assigned_to       UUID REFERENCES admin_users(id),
  customer_seen_at  TIMESTAMPTZ,
  staff_seen_at     TIMESTAMPTZ,
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_customer_idx ON support_tickets(customer_id, last_message_at DESC);
CREATE INDEX support_tickets_queue_idx ON support_tickets(status, last_message_at);
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL CHECK (sender IN ('customer','support')),
  admin_user_id   UUID REFERENCES admin_users(id),
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((sender = 'support') = (admin_user_id IS NOT NULL))
);
CREATE INDEX support_messages_ticket_idx ON support_messages(ticket_id, created_at);

-- =====================================================================
-- Operations
-- =====================================================================

-- What admins changed (settings, prices, stock uploads, code reveals …)
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  admin_user_id   UUID REFERENCES admin_users(id),
  action          TEXT NOT NULL,              -- 'settings.update', 'stock.upload', 'order.reveal_codes' …
  entity_type     TEXT,
  entity_id       TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX audit_log_recent_idx ON audit_log(created_at DESC);

-- Background work (fulfil an order, retry a provider call, send a notification …).
-- Workers claim rows with FOR UPDATE SKIP LOCKED, so several server processes can share the queue.
CREATE TABLE jobs (
  id             BIGSERIAL PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
  dedupe_key     TEXT,
  run_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 8,
  locked_at      TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE status = 'queued';
-- at most one queued job per dedupe key; the worker also never runs two jobs with the same key at once
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued';
CREATE INDEX jobs_running_key_idx ON jobs(dedupe_key) WHERE status = 'running';
CREATE TRIGGER jobs_updated BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stock per product, as the app and admin see it (codes on hand + pre-orders still owed).
CREATE VIEW product_stock AS
SELECT p.id AS product_id,
       p.brand_id,
       p.face_value_cents,
       COALESCE(c.available, 0)::int AS codes_available,
       COALESCE(w.owed, 0)::int      AS preorders_owed
FROM products p
LEFT JOIN (SELECT product_id, count(*) AS available FROM gift_codes WHERE status = 'available' GROUP BY product_id) c
       ON c.product_id = p.id
LEFT JOIN (SELECT product_id, sum(quantity - delivered_quantity) AS owed FROM order_items WHERE status = 'waiting' GROUP BY product_id) w
       ON w.product_id = p.id;
