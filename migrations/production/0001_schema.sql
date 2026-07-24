PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
  campus TEXT NOT NULL,
  track_id TEXT NOT NULL CHECK (track_id IN ('interaction', 'health')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  member_limit INTEGER NOT NULL CHECK (member_limit > 0),
  captain_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (captain_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  track_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  allow_late INTEGER NOT NULL DEFAULT 0,
  image_limit INTEGER NOT NULL DEFAULT 3,
  copy_requirement TEXT NOT NULL DEFAULT '',
  submission_type TEXT NOT NULL,
  status TEXT NOT NULL,
  schedule_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL DEFAULT '',
  copy_text TEXT NOT NULL DEFAULT '',
  plaza_copy TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_submission_images (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES task_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_checkins (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS material_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL,
  allowed_types_json TEXT NOT NULL,
  file_limit INTEGER NOT NULL,
  require_summary INTEGER NOT NULL DEFAULT 0,
  owner_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS material_submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  submitted_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES material_tasks(id)
);

CREATE TABLE IF NOT EXISTS material_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES material_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plaza_posts (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  team_id TEXT NOT NULL,
  copy_text TEXT NOT NULL,
  status TEXT NOT NULL,
  excluded_from_ranking INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES task_submissions(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS plaza_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  liked_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES plaza_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plaza_views (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES plaza_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ranking_cache (
  period TEXT NOT NULL,
  rank INTEGER NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  public_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (period, team_id)
);

CREATE TABLE IF NOT EXISTS ranking_freezes (
  period TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  frozen_at TEXT NOT NULL,
  FOREIGN KEY (frozen_by) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_role_campus_status ON users(role, campus, status);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_checkins_occurrence_user
  ON member_checkins(task_id, occurrence_date, user_id);
CREATE INDEX IF NOT EXISTS idx_member_checkins_team_occurrence
  ON member_checkins(team_id, task_id, occurrence_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_submissions_owner_occurrence
  ON task_submissions(task_id, owner_type, owner_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status_time
  ON task_submissions(status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_submissions_owner
  ON material_submissions(task_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_material_submissions_status_time
  ON material_submissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_plaza_posts_visible_time
  ON plaza_posts(status, excluded_from_ranking, published_at);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_time ON plaza_likes(liked_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plaza_views_window
  ON plaza_views(post_id, user_id, window_started_at);
CREATE INDEX IF NOT EXISTS idx_plaza_views_time ON plaza_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_ranking_cache_period_rank ON ranking_cache(period, rank);

INSERT OR IGNORE INTO app_config (key, value_json)
VALUES
  ('activityEnabled', 'false'),
  ('trackEnabled', '{"interaction":false,"health":false}'),
  ('maxTeams', '50');
