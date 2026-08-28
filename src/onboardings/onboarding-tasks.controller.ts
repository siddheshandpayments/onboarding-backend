import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingTasksService } from './onboarding-tasks.service';

// No @Roles() here on purpose: which side of a task a caller may
// complete is data-dependent (role must match this specific task's
// owner_role, or the caller must be this specific onboarding's
// employee) rather than a fixed role check RolesGuard can express —
// see OnboardingTasksService for the actual authorization. Whether a
// single call finishes the task outright or has to wait on the other
// side also depends on the task's completion_mode, not the route.
@Controller('onboarding-tasks')
export class OnboardingTasksController {
  constructor(private readonly onboardingTasksService: OnboardingTasksService) {}

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
}
