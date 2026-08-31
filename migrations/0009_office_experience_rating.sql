-- One rating per onboarding (an employee rates their own onboarding
-- experience once, can update it any time) — kept on the onboarding
-- row itself rather than a separate table, since it's a 1:1 fact
-- about that onboarding, not a repeating log.
ALTER TABLE onboardings ADD COLUMN experience_rating SMALLINT CHECK (experience_rating BETWEEN 1 AND 5);
ALTER TABLE onboardings ADD COLUMN experience_comment TEXT;
ALTER TABLE onboardings ADD COLUMN experience_rated_at TIMESTAMPTZ;
