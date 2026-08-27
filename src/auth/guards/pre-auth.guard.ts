import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../tokens/token.service';
import { extractBearerToken } from './extract-bearer-token';

/**
 * Guards every step-5 endpoint (TOTP enroll/verify, password reset)
 * that used to trust a client-supplied userId. Now the identity comes
 * from a pre-auth token that only exists because AuthService already
 * verified a password for this exact user — nothing here is
 * client-controlled input.
 */
@Injectable()
export class PreAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing pre-auth token');
    }
    const payload = this.tokens.verifyPreAuth(token);
    (request as any).preAuth = { userId: payload.sub, totpVerified: payload.totpVerified };
    return true;
  }
}
