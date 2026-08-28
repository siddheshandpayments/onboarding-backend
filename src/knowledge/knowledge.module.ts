import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingsModule } from '../onboardings/onboardings.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ClaimedAccountGuard } from './guards/claimed-account.guard';

@Module({
  imports: [AuthModule, OnboardingsModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ClaimedAccountGuard],
})
export class KnowledgeModule {}
