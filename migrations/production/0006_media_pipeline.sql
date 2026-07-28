-- Test first. This migration is additive and keeps all legacy image tables intact.
CREATE TABLE IF NOT EXISTS media_upload_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT,
  business_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  expected_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','expired','rejected','deleted')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT,
  business_type TEXT NOT NULL,
  business_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  etag TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_upload_intents_user_created
  ON media_upload_intents(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_upload_intents_status_expires
  ON media_upload_intents(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_owner_created
  ON media_objects(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_visibility_created
  ON media_objects(visibility, created_at);

