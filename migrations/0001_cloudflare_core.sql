PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_sha256 TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  campus TEXT NOT NULL,
  track_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  track_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  image_limit INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS ranking_cache (
  period TEXT NOT NULL,
  rank INTEGER NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (period, team_id)
);

CREATE TABLE IF NOT EXISTS load_uploads (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_status_track ON users(status, track_id);
CREATE INDEX IF NOT EXISTS idx_tasks_track_status_time
  ON tasks(track_id, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_ranking_cache_period_rank
  ON ranking_cache(period, rank);
CREATE INDEX IF NOT EXISTS idx_load_uploads_uploaded_at
  ON load_uploads(uploaded_at);

DELETE FROM users WHERE id LIKE 'load-%';
INSERT INTO users (
  id, student_id, name, password_sha256, role, campus, track_id, status, created_at
)
WITH RECURSIVE sequence(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM sequence WHERE n < 700
)
SELECT
  'load-' || n,
  'L' || printf('%04d', n),
  '压力用户' || n,
  'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
  'student',
  CASE n % 4
    WHEN 0 THEN '旗山校区'
    WHEN 1 THEN '仓山校区'
    WHEN 2 THEN '怡山校区'
    ELSE '晋江校区'
  END,
  'health',
  'active',
  datetime('now')
FROM sequence;

INSERT OR REPLACE INTO tasks (
  id, name, description, track_id, status, starts_at, ends_at, image_limit
) VALUES (
  'load-task', 'Cloudflare 压力测试任务', '仅用于上线前测试', 'health',
  'published', '2026-07-01T00:00:00.000Z', '2026-08-31T23:59:59.000Z', 3
);

DELETE FROM ranking_cache WHERE period = 'load-test';
INSERT INTO ranking_cache (
  period, rank, team_id, team_name, likes, views, score, generated_at
) VALUES
  ('load-test', 1, 'team-1', '测试队伍一', 120, 320, 1.0, datetime('now')),
  ('load-test', 2, 'team-2', '测试队伍二', 90, 280, 0.78, datetime('now')),
  ('load-test', 3, 'team-3', '测试队伍三', 70, 220, 0.61, datetime('now'));
