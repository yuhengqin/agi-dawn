CREATE TABLE IF NOT EXISTS reader_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id text NOT NULL REFERENCES articles(id),
  body_key text NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  quote text NOT NULL,
  color text NOT NULL CHECK (color IN ('yellow', 'pink', 'blue', 'ink')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (article_id, body_key, start_offset, end_offset)
);
