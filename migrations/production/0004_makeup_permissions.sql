CREATE TABLE IF NOT EXISTS makeup_permissions (
  user_id TEXT NOT NULL,
  checkin_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_makeup_permissions_date_enabled
  ON makeup_permissions(checkin_date, enabled);
