import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingTasksService } from './onboarding-tasks.service';
import { AssignTaskDto } from './dto/assign-task.dto';

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

  // Unclaimed owner/dual tasks matching the caller's own role — the
  // list claimTask() has nothing to act against without.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('task_owner')
  @Get('claimable')
  listClaimable(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingTasksService.listClaimableTasks(user);
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

  // Every onboarding in the caller's own department, with the same
  // progress counts as HR's company-wide list — scoped server-side to
  // the department on the caller's own JWT, never a client-supplied id.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('task_owner')
  @Get('department-onboardings')
  listDepartmentOnboardings(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingTasksService.listDepartmentOnboardings(user);
  }

  // A task owner scheduling an ad-hoc task onto one onboarding in their
  // own department — restricted to that department in the service, not
  // just here.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('task_owner')
  @Post('assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Body() dto: AssignTaskDto) {
    return this.onboardingTasksService.assignTaskByOwner(user, dto);
  }
}
