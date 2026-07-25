PRAGMA foreign_keys = ON;

ALTER TABLE material_submissions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE member_checkins ADD COLUMN content_type TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE member_checkins ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_task_images_submission
  ON task_submission_images(submission_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_material_files_submission
  ON material_files(submission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_user_time
  ON plaza_likes(user_id, liked_at);
CREATE INDEX IF NOT EXISTS idx_plaza_views_post_user_time
  ON plaza_views(post_id, user_id, viewed_at);
