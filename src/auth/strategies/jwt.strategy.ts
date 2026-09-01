import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessPayload } from '../tokens/token.service';

export interface AuthenticatedUser {
  id: string;
  role: 'superadmin_hr' | 'task_owner' | 'employee';
  departmentId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: AccessPayload): AuthenticatedUser {
    if (payload.type !== 'access') {
      // Belt-and-braces: passport-jwt already verified the signature
      // against the access secret, but confirm the claim too in case
      // secrets are ever shared across token kinds down the line.
      throw new UnauthorizedException('Invalid token for this operation');
    }
    return {
      id: payload.sub,
      role: payload.role as AuthenticatedUser['role'],
      departmentId: payload.departmentId,
    };
  }
}
