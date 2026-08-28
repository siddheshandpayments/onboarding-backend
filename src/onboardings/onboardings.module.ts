import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TemplatesModule } from '../templates/templates.module';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';
import { OnboardingTasksController } from './onboarding-tasks.controller';
import { OnboardingTasksService } from './onboarding-tasks.service';

@Module({
  imports: [AuthModule, UsersModule, TemplatesModule],
  controllers: [OnboardingsController, OnboardingTasksController],
  providers: [OnboardingsService, OnboardingTasksService],
  exports: [OnboardingsService, OnboardingTasksService],
})
export class OnboardingsModule {}
