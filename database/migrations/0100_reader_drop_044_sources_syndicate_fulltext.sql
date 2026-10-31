-- Retired editorial state; this reader is installed on a new, isolated database.
ALTER TABLE sources DROP COLUMN IF EXISTS syndicate_fulltext;
