import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClaimedAccountGuard } from './guards/claimed-account.guard';
import {
  ClaimedOnboarding,
  ClaimedOnboardingContext,
} from './decorators/claimed-onboarding.decorator';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // No auth at all — visibility = 'public' only.
  @Get('public')
  listPublic(@Query('departmentId') departmentId?: string) {
    return this.knowledgeService.listPublicArticles(departmentId);
  }

  // Claimed account, still pre-checkpoint — visibility 'public' +
  // 'pre_email_auth'. Department comes from the guard, not the query
  // string.
  @UseGuards(JwtAuthGuard, ClaimedAccountGuard)
  @Get('pre-checkpoint')
  listPreCheckpoint(@ClaimedOnboarding() ctx: ClaimedOnboardingContext) {
    return this.knowledgeService.listPreCheckpointArticles(ctx.departmentId);
  }
}
