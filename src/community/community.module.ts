import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

@Module({
  imports: [AuthModule, ActivityLogModule],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
