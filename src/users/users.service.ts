import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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
         (full_name, phone_number, temp_login_email, password_hash, role, department_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'invited')
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
   *  issued it. This does NOT enable login with it yet — see the
   *  users.company_email_active flip in AuthService on first successful
   *  company-email login (Step 6). */
  async recordCompanyEmail(userId: string, companyEmail: string) {
    await this.db.query(
      `UPDATE users
       SET company_email = $2, must_reset_password = true
       WHERE id = $1`,
      [userId, companyEmail],
    );
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
