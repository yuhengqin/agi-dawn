-- Retired editorial state; this reader is installed on a new, isolated database.
ALTER TABLE publications DROP COLUMN IF EXISTS visible_after;
