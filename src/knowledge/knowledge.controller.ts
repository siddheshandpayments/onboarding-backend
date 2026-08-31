import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClaimedAccountGuard } from './guards/claimed-account.guard';
import {
  ClaimedOnboarding,
  ClaimedOnboardingContext,
} from './decorators/claimed-onboarding.decorator';
import { KnowledgeService } from './knowledge.service';
import { parsePagination } from '../common/list-query.util';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // No auth at all — visibility = 'public' only. Step 33: limit/offset
  // pagination.
  @Get('public')
  listPublic(
    @Query('departmentId') departmentId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.knowledgeService.listPublicArticles(departmentId, parsePagination({ limit, offset }));
  }

  // Claimed account, still pre-checkpoint — visibility 'public' +
  // 'pre_email_auth'. Department comes from the guard, not the query
  // string. Step 33: limit/offset pagination.
  @UseGuards(JwtAuthGuard, ClaimedAccountGuard)
  @Get('pre-checkpoint')
  listPreCheckpoint(
    @ClaimedOnboarding() ctx: ClaimedOnboardingContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.knowledgeService.listPreCheckpointArticles(
      ctx.departmentId,
      parsePagination({ limit, offset }),
    );
  }
}
