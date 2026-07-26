CREATE TABLE IF NOT EXISTS image_variants (
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_type, source_id, variant)
);

CREATE TABLE IF NOT EXISTS plaza_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (post_id) REFERENCES plaza_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('comment', 'system', 'admin')),
  actor_id TEXT,
  post_id TEXT,
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (post_id) REFERENCES plaza_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plaza_comments_post_status_created
  ON plaza_comments(post_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaza_comments_user_created
  ON plaza_comments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaza_posts_status_published
  ON plaza_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_post
  ON plaza_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_plaza_views_post
  ON plaza_views(post_id);
