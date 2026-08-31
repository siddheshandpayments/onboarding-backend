-- Ask Me Anything: a post can be tagged as a question, so it can be
-- filtered separately from the regular feed without a whole second
-- system — same anonymity rules apply, is_question is not identity.
ALTER TABLE community_posts ADD COLUMN is_question BOOLEAN NOT NULL DEFAULT false;
