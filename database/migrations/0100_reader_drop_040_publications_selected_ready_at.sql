-- Retired editorial state; this reader is installed on a new, isolated database.
ALTER TABLE publications DROP COLUMN IF EXISTS selected_ready_at;
