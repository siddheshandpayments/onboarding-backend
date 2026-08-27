import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Runs after JwtAuthGuard, which populates req.user from the access
 * token. Reads the roles set by @Roles(...) on the handler (falling
 * back to the controller class) and 403s if the caller's role isn't
 * in that list.
 *
 * A route wired to this guard with no @Roles() at all fails closed
 * (403) rather than being treated as "any authenticated role" — that
 * case is a wiring mistake, and staying open by default is exactly
 * the kind of thing the "server-side authorization always" rule is
 * meant to catch. Routes that genuinely allow any authenticated role
 * should use JwtAuthGuard alone, with no RolesGuard/@Roles() at all.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      AuthenticatedUser['role'][] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      throw new ForbiddenException('No roles configured for this route');
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
