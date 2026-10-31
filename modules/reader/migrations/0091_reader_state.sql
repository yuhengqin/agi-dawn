CREATE TABLE IF NOT EXISTS reader_state (
  article_id text PRIMARY KEY REFERENCES articles(id),
  starred boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'to-read' CHECK (status IN ('to-read','reading','read')),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
