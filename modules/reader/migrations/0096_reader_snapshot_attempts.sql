ALTER TABLE reader_snapshots ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
