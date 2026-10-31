ALTER TABLE articles ADD COLUMN IF NOT EXISTS body_quality text NOT NULL DEFAULT 'ready';
