CREATE TABLE IF NOT EXISTS reader_positions (
  article_id text NOT NULL REFERENCES articles(id),
  body_hash text NOT NULL CHECK (body_hash ~ '^[a-f0-9]{64}$'),
  snapshot_id text NOT NULL REFERENCES reader_snapshots(id),
  anchor text,
  section_offset double precision NOT NULL CHECK (section_offset BETWEEN 0 AND 1),
  progress double precision NOT NULL CHECK (progress BETWEEN 0 AND 1),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id,body_hash)
);
