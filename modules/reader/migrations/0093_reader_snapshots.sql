CREATE TABLE IF NOT EXISTS reader_snapshots (
  id text PRIMARY KEY,
  article_id text NOT NULL REFERENCES articles(id),
  body_revision integer NOT NULL,
  representation_hash text NOT NULL,
  data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','complete')),
  format_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(article_id,body_revision,representation_hash)
);
