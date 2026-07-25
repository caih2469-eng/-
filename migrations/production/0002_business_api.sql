PRAGMA foreign_keys = ON;

ALTER TABLE task_submissions ADD COLUMN meal_type TEXT;

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  checkin_date TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS checkin_files (
  id TEXT PRIMARY KEY,
  checkin_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'summary')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (checkin_id) REFERENCES checkins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, key, actor_id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  identity_hash TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date_slot
  ON checkins(user_id, checkin_date, slot_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date_status
  ON checkins(checkin_date, status);
CREATE INDEX IF NOT EXISTS idx_checkin_files_checkin
  ON checkin_files(checkin_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
  ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time
  ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_track_status_window
  ON tasks(track_id, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_material_tasks_owner_status_deadline
  ON material_tasks(owner_type, status, deadline);
