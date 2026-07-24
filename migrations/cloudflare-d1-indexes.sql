-- Cloudflare D1 production indexes for the 700+ participant workload.
-- Apply after the relational tables have been created in the Cloudflare migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_role_campus_status ON users(role, campus, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_checkins_occurrence_user
  ON member_checkins(task_id, occurrence_date, user_id);
CREATE INDEX IF NOT EXISTS idx_member_checkins_team_occurrence
  ON member_checkins(team_id, task_id, occurrence_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_submissions_owner_occurrence
  ON task_submissions(task_id, owner_type, owner_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status_time
  ON task_submissions(status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_submissions_user
  ON material_submissions(task_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_material_submissions_status_time
  ON material_submissions(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_plaza_posts_visible_time
  ON plaza_posts(status, excluded_from_ranking, published_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plaza_likes_post_user ON plaza_likes(post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_time ON plaza_likes(liked_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plaza_views_window
  ON plaza_views(post_id, user_id, window_started_at);
CREATE INDEX IF NOT EXISTS idx_plaza_views_time ON plaza_views(viewed_at);
