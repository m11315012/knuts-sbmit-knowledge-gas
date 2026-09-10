ALTER TABLE submissions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS archived_by varchar(64);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS deleted_by varchar(64);
CREATE INDEX IF NOT EXISTS submissions_archive_idx ON submissions(archived_at, deleted_at, submitted_at DESC);
