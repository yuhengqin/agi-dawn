CREATE TABLE IF NOT EXISTS article_engagement (
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
  viewed_at timestamptz,
  liked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (article_id, visitor_hash)
);
