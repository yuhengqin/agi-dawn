-- Retired editorial state; this reader is installed on a new, isolated database.
ALTER TABLE articles DROP COLUMN IF EXISTS selection_value_reason;
