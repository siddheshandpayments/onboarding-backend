import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService, UserRow } from '../users/users.service';
import { DatabaseService } from '../database/database.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateUserDto } from './dto/create-user.dto';
import { generateLoginEmail, generateTempPassword } from './utils/credential-generator';
import { generateTotpEnrollment, verifyTotpCode } from './utils/totp';
import { TokenService } from './tokens/token.service';

const BCRYPT_ROUNDS = 12;

/** Shape returned by every step in the login/enrollment/reset flow: either
 *  "here's what's still needed, plus a pre-auth token to continue with",
 *  or "fully authenticated, here are your real tokens." Every endpoint in
 *  this flow returns one of these two shapes — never a partial mix. */
type AuthProgress =
  | {
      status: 'requires_next';
      preAuthToken: string;
      requiresPasswordReset: boolean;
      requiresTotpEnrollment: boolean;
      requiresTotpVerification: boolean;
    }
  | {
      status: 'authenticated';
      accessToken: string;
      refreshToken: string;
      user: ReturnType<UsersService['toPublicUser']>;
    };

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    // Global provider (DatabaseModule is @Global()) — injected directly
    // here rather than importing OnboardingsModule, which would create
    // a circular module dependency (OnboardingsModule already imports
    // AuthModule for its guards). See completeCompanyEmailPasswordReset.
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async createUser(dto: CreateUserDto, actorId: string) {
    const domain = this.config.get<string>('LOGIN_EMAIL_DOMAIN')!;
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    let user;
    let attempts = 0;
    while (!user) {
      const tempLoginEmail = generateLoginEmail(dto.fullName, domain);
      try {
        user = await this.usersService.insertUser({
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          tempLoginEmail,
          passwordHash,
          role: dto.role,
          departmentId: dto.departmentId ?? null,
        });
      } catch (err) {
        attempts++;
        if (attempts >= 3) throw err;
      }
    }

    // Role/department are fine to log — never the temp password or
    // its hash, which never leave this method except in the one-time
    // credentials payload below.
    await this.activityLog.log({
      actorId,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      metadata: { role: dto.role, departmentId: dto.departmentId ?? null },
    });

    return {
      user: this.usersService.toPublicUser(user),
      credentials: {
        loginEmail: user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  async regenerateCredentials(userId: string, actorId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash); // forceReset defaults true

    await this.activityLog.log({
      actorId,
      action: 'user.credentials_regenerated',
      entityType: 'user',
      entityId: userId,
    });

    return {
      credentials: {
        loginEmail: user.company_email_active ? user.company_email : user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  // ============================================================
  // STEP 5+6 — password verification, TOTP, forced-reset state
  // machine, now wired to real token issuance.
  // ============================================================

  private async resolveUserByIdentifier(identifier: string): Promise<UserRow> {
    const byCompanyEmail = await this.usersService.findByCompanyEmail(identifier);
    if (byCompanyEmail) {
      if (!byCompanyEmail.company_email_active) {
        throw new UnauthorizedException('Invalid credentials');
      }
      return byCompanyEmail;
    }

    const byTempEmail = await this.usersService.findByTempLoginEmail(identifier);
    if (byTempEmail) {
      if (byTempEmail.company_email_active) {
        throw new UnauthorizedException(
          'This login is no longer active — use your company email.',
        );
      }
      return byTempEmail;
    }

    throw new UnauthorizedException('Invalid credentials');
  }

  /** Computes what's still outstanding from persistent DB state alone.
   *  requiresTotpVerification here means "TOTP is enrolled and would
   *  need checking in a fresh session" — whether THIS session already
   *  did that check is tracked separately via the pre-auth token's
   *  totpVerified claim, not by anything in the database. */
  private authRequirementsFor(user: UserRow) {
    return {
      requiresPasswordReset: user.must_reset_password,
      requiresTotpEnrollment: !user.totp_enrolled_at,
      requiresTotpVerification: !!user.totp_enrolled_at,
    };
  }

  /** Central decision point, called after every step (password verify,
   *  totp enroll/verify, password reset). Re-reads the user fresh so
   *  DB-persistent requirements are always current, combines that with
   *  the session-scoped totpVerified flag carried on the pre-auth
   *  token, and either issues real tokens or a fresh pre-auth token
   *  reflecting what's still left. */
  private async progressFor(
    userId: string,
    sessionTotpVerified: boolean,
  ): Promise<AuthProgress> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const { requiresPasswordReset, requiresTotpEnrollment } =
      this.authRequirementsFor(user);
    const stillNeedsTotpThisSession =
      !requiresTotpEnrollment && !sessionTotpVerified;

    if (!requiresPasswordReset && !requiresTotpEnrollment && !stillNeedsTotpThisSession) {
      if (user.status === 'invited') {
        await this.usersService.activateUser(userId);
        user.status = 'active'; // keep the response consistent with what we just wrote
      }
      return {
        status: 'authenticated',
        accessToken: this.tokens.signAccessToken(user),
        refreshToken: this.tokens.signRefreshToken(user),
        user: this.usersService.toPublicUser(user),
      };
    }

    return {
      status: 'requires_next',
      preAuthToken: this.tokens.signPreAuth(userId, sessionTotpVerified),
      requiresPasswordReset,
      requiresTotpEnrollment,
      requiresTotpVerification: stillNeedsTotpThisSession,
    };
  }

  /** Entry point: password only. Always returns a pre-auth token — no
   *  login in this system ever skips TOTP, so this step never issues
   *  real tokens directly, even for a fully steady-state account. */
  async login(loginIdentifier: string, password: string): Promise<AuthProgress> {
    const user = await this.resolveUserByIdentifier(loginIdentifier);

    if (user.status === 'disabled') {
      throw new ForbiddenException('This account has been disabled');
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.progressFor(user.id, false);
  }

  async startTotpEnrollment(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.totp_enrolled_at) {
      throw new ForbiddenException('TOTP is already enrolled for this account');
    }

    const issuer = this.config.get<string>('TOTP_ISSUER')!;
    const accountLabel = user.company_email_active
      ? user.company_email!
      : user.temp_login_email;

    const enrollment = await generateTotpEnrollment(accountLabel, issuer);
    await this.usersService.setPendingTotpSecret(userId, enrollment.secret);

    return {
      otpauthUri: enrollment.otpauthUri,
      qrCodeDataUrl: enrollment.qrCodeDataUrl,
    };
  }

  async confirmTotpEnrollment(userId: string, code: string): Promise<AuthProgress> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.totp_secret) {
      throw new ForbiddenException('No pending TOTP enrollment for this account');
    }
    if (!verifyTotpCode(code, user.totp_secret)) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.usersService.markTotpEnrolled(userId);
    // Confirming enrollment inherently proves a valid code was entered
    // this session, so it satisfies the steady-state TOTP check too.
    return this.progressFor(userId, true);
  }

  async verifyTotpForLogin(userId: string, code: string): Promise<AuthProgress> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.totp_secret || !user.totp_enrolled_at) {
      throw new ForbiddenException('TOTP is not enrolled for this account');
    }
    if (!verifyTotpCode(code, user.totp_secret)) {
      throw new UnauthorizedException('Invalid code');
    }
    return this.progressFor(userId, true);
  }

  async completeFirstLoginPasswordReset(
    userId: string,
    newPassword: string,
    sessionTotpVerified: boolean,
  ): Promise<AuthProgress> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash, false);
    return this.progressFor(userId, sessionTotpVerified);
  }

  async completeCompanyEmailPasswordReset(
    userId: string,
    newPassword: string,
    sessionTotpVerified: boolean,
  ): Promise<AuthProgress> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.company_email) {
      throw new ForbiddenException('No company email recorded for this account');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash, false);
    await this.usersService.setCompanyEmailActive(userId);

    // Step 17: first successful company-email login is the trigger for
    // the onboarding's second status transition. Guarded on an IN-list
    // rather than exactly 'email_provisioned' because provisioning and
    // this first login aren't strictly ordered by the system (HR, IT,
    // and the employee are independent actors) — this only ever moves
    // status forward, never backward, and is a no-op for accounts with
    // no onboarding at all (task_owner/superadmin_hr).
    await this.db.query(
      `UPDATE onboardings SET status = 'checkpoint_pending'
       WHERE user_id = $1 AND status IN ('pre_onboarding', 'email_provisioned')`,
      [userId],
    );

    return this.progressFor(userId, sessionTotpVerified);
  }

  // ============================================================
  // Token refresh
  // ============================================================

  async refreshAccessToken(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return {
      accessToken: this.tokens.signAccessToken(user),
      // Rotated on every refresh. Note: this is stateless rotation —
      // there's no server-side record of issued/revoked refresh tokens
      // yet, so an old refresh token technically still verifies until
      // it expires on its own. A refresh_tokens table with a revoked
      // flag would close that gap; flagging it rather than pretending
      // rotation alone is full revocation.
      refreshToken: this.tokens.signRefreshToken(user),
    };
  }
}
