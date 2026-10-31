CREATE TABLE IF NOT EXISTS reader_assets (
  hash text PRIMARY KEY,
  mime text NOT NULL,
  bytes integer NOT NULL,
  path text NOT NULL
);
