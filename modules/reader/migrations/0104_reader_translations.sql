CREATE TABLE reader_translations (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  body_revision integer,
  source_html text,
  body_html text,
  complete boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','translated','partial','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  model text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
