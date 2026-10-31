CREATE TABLE reader_metadata_translations (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  source_title text NOT NULL,
  source_summary text,
  title text,
  summary text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','translated','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  model text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
