-- Comment moderation needs the same reason trail as post moderation
-- (CommunityService.deletePost) — deleted_at/deleted_by already exist
-- on community_comments, delete_reason was the one column missing.
ALTER TABLE community_comments ADD COLUMN delete_reason TEXT;
