import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard/RolesGuard on the controller
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService], // OnboardingsModule (step 12) needs this for instantiation
})
export class TemplatesModule {}
