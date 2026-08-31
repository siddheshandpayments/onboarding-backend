import { Injectable } from '@nestjs/common';
import { QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { slugifyNameForCompanyEmail } from '../auth/utils/credential-generator';

/** Same structural-typing trick as TemplatesService/OnboardingsService —
 *  lets recordCompanyEmail() run either standalone or as part of a
 *  caller's own transaction (see OnboardingsService.provisionCompanyEmail). */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface UserRow {
  id: string;
  full_name: string;
  phone_number: string;
  temp_login_email: string;
  company_email: string | null;
  company_email_active: boolean;
  must_reset_password: boolean;
  password_hash: string;
  totp_secret: string | null;
  totp_enrolled_at: Date | null;
  role: 'superadmin_hr' | 'task_owner' | 'employee';
  department_id: string | null;
  status: 'invited' | 'active' | 'disabled';
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Fields safe to ever return from an API response. temp_login_email is
 *  deliberately excluded once company_email_active = true — see
 *  toPublicUser(). password_hash and totp_secret are never included,
 *  period, regardless of state. */
export type PublicUser = Omit<
  UserRow,
  'password_hash' | 'totp_secret' | 'temp_login_email'
> & { temp_login_email: string | null };

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async insertUser(fields: {
    fullName: string;
    phoneNumber: string;
    tempLoginEmail: string;
    passwordHash: string;
    role: string;
    departmentId: string | null;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users
         (full_name, phone_number, temp_login_email, password_hash, role, department_id, status, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'invited', true)
       RETURNING *`,
      [
        fields.fullName,
        fields.phoneNumber,
        fields.tempLoginEmail,
        fields.passwordHash,
        fields.role,
        fields.departmentId,
      ],
    );
    return rows[0];
  }

  async findByTempLoginEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE temp_login_email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return rows[0] ?? null;
  }

  async findByCompanyEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE company_email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** HR records the company email once IT/the company mail system has
   *  issued it, along with a fresh temp password for it — same
   *  "admin-issued credential" shape as user creation, since logging
   *  into a brand new company-email identity needs its own temp
   *  password rather than reusing whatever the employee already
   *  chose for their temp login. This does NOT enable login with it
   *  yet — see the users.company_email_active flip in AuthService on
   *  first successful company-email login (Step 6). Accepts an
   *  optional queryable so OnboardingsService.provisionCompanyEmail
   *  (Step 17) can run this in the same transaction as its own
   *  onboardings.status flip. */
  async recordCompanyEmail(
    userId: string,
    companyEmail: string,
    passwordHash: string,
    queryable: Queryable = this.db,
  ) {
    await queryable.query(
      `UPDATE users
       SET company_email = $2, password_hash = $3, must_reset_password = true
       WHERE id = $1`,
      [userId, companyEmail, passwordHash],
    );
  }

  /** Deterministic collision handling for a REAL company email:
   *  "Sam Row" -> samrow@domain, and if that's taken (another Sam Row)
   *  -> samrow1@domain, samrow2@domain, ... — unlike the synthetic
   *  temp login's random suffix, this has to read as a normal address
   *  and stay stable, so it's an incrementing integer, not randomness.
   *  Checked against the SAME queryable the caller inserts under, so
   *  this can run inside OnboardingsService.provisionCompanyEmail's
   *  transaction without racing a concurrent read outside it. */
  async generateUniqueCompanyEmail(
    fullName: string,
    domain: string,
    queryable: Queryable = this.db,
  ): Promise<string> {
    const base = slugifyNameForCompanyEmail(fullName);
    let suffix = 0;
    while (true) {
      const candidate = suffix === 0 ? `${base}@${domain}` : `${base}${suffix}@${domain}`;
      const { rows } = await queryable.query<{ id: string }>(
        `SELECT id FROM users WHERE company_email = $1`,
        [candidate],
      );
      if (rows.length === 0) return candidate;
      suffix++;
    }
  }

  /** Overwrites the password hash. forceReset=true (the default for any
   *  admin-issued temp password) also flips must_reset_password so the
   *  temp value can never quietly become a permanent one. */
  async setPasswordHash(
    userId: string,
    passwordHash: string,
    forceReset = true,
  ) {
    await this.db.query(
      `UPDATE users SET password_hash = $2, must_reset_password = $3 WHERE id = $1`,
      [userId, passwordHash, forceReset],
    );
  }

  /** Stores a freshly-generated TOTP secret, pending confirmation
   *  (totp_enrolled_at stays NULL until the user proves they can
   *  generate a valid code from it). */
  async setPendingTotpSecret(userId: string, secret: string) {
    await this.db.query(
      `UPDATE users SET totp_secret = $2, totp_enrolled_at = NULL WHERE id = $1`,
      [userId, secret],
    );
  }

  async markTotpEnrolled(userId: string) {
    await this.db.query(
      `UPDATE users SET totp_enrolled_at = now() WHERE id = $1`,
      [userId],
    );
  }

  async setCompanyEmailActive(userId: string) {
    await this.db.query(
      `UPDATE users SET company_email_active = true WHERE id = $1`,
      [userId],
    );
  }

  async activateUser(userId: string) {
    await this.db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
      userId,
    ]);
  }

  /** Strips fields that must never leave the API, and additionally hides
   *  temp_login_email once the account has switched over to company
   *  email — from that point on, the temp identifier is dead weight for
   *  any client to know about, not just insecure to display. */
  toPublicUser(user: UserRow): PublicUser {
    const { password_hash, totp_secret, ...rest } = user;
    return {
      ...rest,
      temp_login_email: user.company_email_active ? null : user.temp_login_email,
    };
  }
}
