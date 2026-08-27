import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../tokens/token.service';
import { extractBearerToken } from './extract-bearer-token';

@Injectable()
export class RefreshGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const payload = this.tokens.verifyRefreshToken(token);
    (request as any).refreshUserId = payload.sub;
    return true;
  }
}
