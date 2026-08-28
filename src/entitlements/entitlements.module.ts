import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [AuthModule, UsersModule, ActivityLogModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
})
export class EntitlementsModule {}
