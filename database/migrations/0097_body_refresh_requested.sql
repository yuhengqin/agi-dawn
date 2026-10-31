ALTER TABLE articles ADD COLUMN IF NOT EXISTS body_refresh_requested_at timestamptz;
