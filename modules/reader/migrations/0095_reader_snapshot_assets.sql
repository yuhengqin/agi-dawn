CREATE TABLE IF NOT EXISTS reader_snapshot_assets (
  snapshot_id text NOT NULL REFERENCES reader_snapshots(id),
  asset_key text NOT NULL,
  original_url text NOT NULL,
  asset_hash text REFERENCES reader_assets(hash),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
  error text,
  PRIMARY KEY(snapshot_id,asset_key)
);
