import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingTasksService } from './onboarding-tasks.service';

@Controller('onboarding-tasks')
export class OnboardingTasksController {
  constructor(private readonly onboardingTasksService: OnboardingTasksService) {}

  // No @Roles() on the three below: which side of a task a caller may
  // act on is data-dependent (role must match this specific task's
  // owner_role, or a specific claim on it, or the caller must be this
  // specific onboarding's employee) rather than a fixed role check
  // RolesGuard can express — see OnboardingTasksService.

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete-as-owner')
  completeAsOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingTasksService.completeAsOwner(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete-as-employee')
  completeAsEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingTasksService.completeAsEmployee(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/claim')
  claim(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.onboardingTasksService.claimTask(id, user);
  }

  // Step 20: TaskOwner dashboard. This one IS a fixed role — there's
  // no per-task ambiguity, it's just "show me what I've claimed." Step
  // 32: allow-listed status/priority/date-range filters, dueDate/
  // priority sort — @Query() with no key captures the full query
  // object so the service can reject unknown keys, not just ignore them.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('task_owner')
  @Get('mine')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.onboardingTasksService.listMyTasks(user, query);
  }
}
