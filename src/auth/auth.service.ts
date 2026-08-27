import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService, UserRow } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { generateLoginEmail, generateTempPassword } from './utils/credential-generator';
import { generateTotpEnrollment, verifyTotpCode } from './utils/totp';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new account (HR creating a joiner, or SuperAdmin creating
   * a TaskOwner/HR account). Returns the temp login email + PLAINTEXT
   * temp password exactly once, in this response — nowhere else, ever
   * again. The hash is what actually gets persisted; the plaintext
   * value returned here is not retrievable through any other endpoint.
   * It's on HR to copy it out of this response and deliver it to the
   * person manually (no personal email is stored, so the system has
   * no address to send it to itself).
   */
  async createUser(dto: CreateUserDto) {
    const domain = this.config.get<string>('LOGIN_EMAIL_DOMAIN')!;
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    // Synthetic email collisions are astronomically unlikely (6-char
    // random suffix) but the DB's UNIQUE constraint is the real
    // guarantee — retry generation a couple of times on the rare clash
    // rather than surfacing a raw constraint-violation error.
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

    return {
      user: this.usersService.toPublicUser(user),
      credentials: {
        loginEmail: user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  /**
   * SuperAdmin/HR action for a locked-out or lost-credential case.
   * Same reveal-once shape as creation. This is the only "password
   * reset" path that exists pre-company-email, since there is no
   * address to send a reset link to.
   */
  async regenerateCredentials(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash); // forceReset defaults true

    return {
      credentials: {
        loginEmail: user.company_email_active ? user.company_email : user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  // ============================================================
  // STEP 5 — password verification + TOTP enrollment/verification +
  // the forced-reset state machine. Real token issuance is Step 6;
  // everything here returns "what's needed next", not a session.
  // ============================================================

  /** Resolves a login identifier against the right column with the
   *  rules we agreed on: temp_login_email works only until the account
   *  has switched over; company_email only works once switched. */
  private async resolveUserByIdentifier(identifier: string): Promise<UserRow> {
    const byCompanyEmail = await this.usersService.findByCompanyEmail(identifier);
    if (byCompanyEmail) {
      if (!byCompanyEmail.company_email_active) {
        // Company email recorded but not yet activated via a first
        // successful login — it simply isn't a valid login path yet.
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

  /** Step 1 of login: password only. Never issues a token — returns
   *  flags telling the caller (Step 6's orchestrator) what still needs
   *  to happen before access is granted. */
  async verifyPassword(loginIdentifier: string, password: string) {
    const user = await this.resolveUserByIdentifier(loginIdentifier);

    if (user.status === 'disabled') {
      throw new ForbiddenException('This account has been disabled');
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      userId: user.id,
      requiresPasswordReset: user.must_reset_password,
      requiresTotpEnrollment: !user.totp_enrolled_at,
      requiresTotpVerification: !!user.totp_enrolled_at && !user.must_reset_password,
    };
  }

  /** Generates (or regenerates, if called again before confirmation) a
   *  pending TOTP secret + QR code for the user to scan. */
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

    // secret itself is not returned — only the otpauth URI / QR, which
    // encodes it. Nothing forces a client to display the raw secret.
    return {
      otpauthUri: enrollment.otpauthUri,
      qrCodeDataUrl: enrollment.qrCodeDataUrl,
    };
  }

  /** Confirms enrollment by requiring one valid code from what the user
   *  just scanned — proves they captured the secret correctly before
   *  it's trusted for real logins. */
  async confirmTotpEnrollment(userId: string, code: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.totp_secret) {
      throw new ForbiddenException('No pending TOTP enrollment for this account');
    }

    if (!verifyTotpCode(code, user.totp_secret)) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.usersService.markTotpEnrolled(userId);
    await this.maybeActivate(userId);
    return { totpEnrolled: true };
  }

  /** Steady-state login TOTP check (account already fully enrolled). */
  async verifyTotpForLogin(userId: string, code: string) {
    const user = await this.usersService.findById(userId);
    if (!user || !user.totp_secret || !user.totp_enrolled_at) {
      throw new ForbiddenException('TOTP is not enrolled for this account');
    }
    if (!verifyTotpCode(code, user.totp_secret)) {
      throw new UnauthorizedException('Invalid code');
    }
    return { totpVerified: true };
  }

  /** Completes the very first login's forced password change (invited
   *  account, still on the admin-issued temp password). Does NOT touch
   *  company_email_active — that only happens via the company-email
   *  bridge flow below. */
  async completeFirstLoginPasswordReset(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash, false);
    await this.maybeActivate(userId);
    return { passwordReset: true };
  }

  /** Completes the company-email bridge login: forces a fresh password
   *  choice and, only now, flips company_email_active so the temp
   *  login identifier stops working and company_email takes over. */
  async completeCompanyEmailPasswordReset(userId: string, newPassword: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.company_email) {
      throw new ForbiddenException('No company email recorded for this account');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash, false);
    await this.usersService.setCompanyEmailActive(userId);
    return { passwordReset: true, companyEmailActive: true };
  }

  /** First-time activation only: flips status invited -> active once
   *  BOTH the temp password has been replaced AND TOTP is enrolled.
   *  Re-reads fresh state rather than trusting caller-supplied flags,
   *  since this can be reached from either completion path. */
  private async maybeActivate(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) return;
    if (
      user.status === 'invited' &&
      !user.must_reset_password &&
      user.totp_enrolled_at
    ) {
      await this.usersService.activateUser(userId);
    }
  }
}
