CREATE TABLE IF NOT EXISTS reader_notes (
  article_id text PRIMARY KEY REFERENCES articles(id),
  text text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
