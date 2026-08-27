import { SetMetadata } from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

export const ROLES_KEY = 'roles';

/** Use alongside @UseGuards(JwtAuthGuard, RolesGuard):
 *  @Roles('superadmin_hr') restricts the route to that role.
 *  A route behind RolesGuard with no @Roles() at all is rejected (fail
 *  closed) rather than treated as "any role" — see RolesGuard. */
export const Roles = (...roles: AuthenticatedUser['role'][]) =>
  SetMetadata(ROLES_KEY, roles);
