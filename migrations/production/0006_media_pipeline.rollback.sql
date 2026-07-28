-- Only use on the isolated test database after confirming no required test media remains.
DROP INDEX IF EXISTS idx_media_objects_visibility_created;
DROP INDEX IF EXISTS idx_media_objects_owner_created;
DROP INDEX IF EXISTS idx_media_upload_intents_status_expires;
DROP INDEX IF EXISTS idx_media_upload_intents_user_created;
DROP TABLE IF EXISTS media_objects;
DROP TABLE IF EXISTS media_upload_intents;
