import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TemplatesModule } from '../templates/templates.module';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [AuthModule, UsersModule, TemplatesModule],
  controllers: [OnboardingsController],
  providers: [OnboardingsService],
  exports: [OnboardingsService],
})
export class OnboardingsModule {}
