CREATE INDEX CONCURRENTLY IF NOT EXISTS reader_snapshots_pending_idx ON reader_snapshots(created_at,id) WHERE status='pending';
