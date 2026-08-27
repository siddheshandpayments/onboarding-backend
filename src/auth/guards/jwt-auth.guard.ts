import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** @UseGuards(JwtAuthGuard) on any endpoint that requires a valid access
 *  token. Step 7's RolesGuard runs after this and reads req.user, which
 *  this guard (via JwtStrategy.validate) populates. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt-access') {}
