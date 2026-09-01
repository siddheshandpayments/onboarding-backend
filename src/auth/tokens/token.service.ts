import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRow } from '../../users/users.service';

export interface PreAuthPayload {
  sub: string;
  type: 'pre_auth';
  totpVerified: boolean;
}

export interface AccessPayload {
  sub: string;
  role: string;
  departmentId: string | null;
  type: 'access';
}

export interface RefreshPayload {
  sub: string;
  type: 'refresh';
}

/**
 * Every token kind gets its own secret AND a `type` claim checked on
 * verify. Two layers on purpose: even if secrets were ever shared by
 * mistake, a token minted as one kind still can't be verified as
 * another, because the type check happens after signature verification
 * succeeds — a forged type claim can't survive re-signing without the
 * right secret in the first place.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---- pre-auth (multi-step login carrier) ----

  signPreAuth(userId: string, totpVerified: boolean): string {
    const payload: PreAuthPayload = { sub: userId, type: 'pre_auth', totpVerified };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_PREAUTH_SECRET'),
      expiresIn: this.config.get<string>('JWT_PREAUTH_EXPIRES_IN'),
    });
  }

  verifyPreAuth(token: string): PreAuthPayload {
    const payload = this.safeVerify<PreAuthPayload>(
      token,
      this.config.get<string>('JWT_PREAUTH_SECRET')!,
    );
    if (payload.type !== 'pre_auth') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return payload;
  }

  // ---- access (real bearer credential) ----

  signAccessToken(user: Pick<UserRow, 'id' | 'role' | 'department_id'>): string {
    const payload: AccessPayload = {
      sub: user.id,
      role: user.role,
      departmentId: user.department_id,
      type: 'access',
    };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
    });
  }

  verifyAccessToken(token: string): AccessPayload {
    const payload = this.safeVerify<AccessPayload>(
      token,
      this.config.get<string>('JWT_ACCESS_SECRET')!,
    );
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return payload;
  }

  // ---- refresh (long-lived, exchanges for a new access token) ----

  signRefreshToken(user: Pick<UserRow, 'id'>): string {
    const payload: RefreshPayload = { sub: user.id, type: 'refresh' };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
    });
  }

  verifyRefreshToken(token: string): RefreshPayload {
    const payload = this.safeVerify<RefreshPayload>(
      token,
      this.config.get<string>('JWT_REFRESH_SECRET')!,
    );
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return payload;
  }

  private safeVerify<T extends object>(token: string, secret: string): T {
    try {
      return this.jwt.verify<T>(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
