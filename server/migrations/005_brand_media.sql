-- Brand pictures (logo, card art, home banner) set in the admin panel, kept in the database so every server
-- and every device sees the same ones. Served at /media/brands/<brand>/<kind>; brands.*_url point there.
CREATE TABLE brand_media (
  brand_id      TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('logo','card','banner')),
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp','image/gif')),
  data          BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1500000),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES admin_users(id),
  PRIMARY KEY (brand_id, kind)
);

-- The starting catalogue had placeholder addresses (assets/logos/<brand>, no file type). The apps find those files
-- themselves; a brand's own picture address is set only when a picture is uploaded.
UPDATE brands SET logo_url = NULL WHERE logo_url LIKE 'assets/%';
UPDATE brands SET card_image_url = NULL WHERE card_image_url LIKE 'assets/%';
UPDATE brands SET banner_url = NULL WHERE banner_url LIKE 'assets/%';
