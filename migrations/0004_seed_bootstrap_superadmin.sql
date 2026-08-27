-- 0004: bootstrap superadmin.
-- Step 7 locked POST /auth/users behind @Roles('superadmin_hr'), which
-- means there was no longer any way to create the FIRST superadmin/HR
-- account through the API — a chicken-and-egg gap. This seeds exactly
-- one, using pgcrypto's crypt()/gen_salt('bf', 12) so the hash format
-- matches BCRYPT_ROUNDS = 12 in AuthService (bcrypt.compare() verifies
-- pgcrypto 'bf' hashes fine — same algorithm, compatible prefix).
--
-- Login: temp_login_email below, password 'Bootstrap#2026Seed'.
-- Dev/seed data only, per the "synthetic data only" rule. Log in once,
-- go through the forced password reset + TOTP enrollment flow like any
-- other account (must_reset_password is true here for that reason),
-- then use this account to create real HR/SuperAdmin users via
-- POST /auth/users. Do not reuse this fixed password outside local dev.

INSERT INTO users (
  full_name, phone_number,
  temp_login_email, password_hash,
  role, department_id,
  status, must_reset_password
) VALUES (
  'Bootstrap Admin', '+10000000000',
  'bootstrap.admin@id.onboarding.internal',
  crypt('Bootstrap#2026Seed', gen_salt('bf', 12)),
  'superadmin_hr', NULL,
  'invited', true
);
