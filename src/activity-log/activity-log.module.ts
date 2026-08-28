import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';

// Deliberately does NOT import AuthModule: AuthService needs
// ActivityLogService (to log 'user.created' etc.), so AuthModule ->
// ActivityLogModule -> AuthModule would be circular. It doesn't need
// to: JwtAuthGuard has no constructor dependencies and RolesGuard's
// only dependency is Reflector, a framework-internal provider Nest
// makes available in every module without an explicit import — the
// same mechanism that lets @UseGuards(RolesGuard) work in vanilla
// Nest apps that never register RolesGuard as a provider anywhere.
@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
