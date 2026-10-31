-- Reader titles are the original title unless explicitly corrected by the administrator.
ALTER TABLE publications DROP COLUMN IF EXISTS original_title;
