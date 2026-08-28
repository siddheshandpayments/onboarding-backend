import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingTasksService } from './onboarding-tasks.service';

// No @Roles() here on purpose: which side of the handover a caller may
// confirm is data-dependent (role must match this specific task's
// owner_role, or the caller must be this specific onboarding's
// employee) rather than a fixed role check RolesGuard can express —
// see OnboardingTasksService for the actual authorization.
@Controller('onboarding-tasks')
export class OnboardingTasksController {
  constructor(private readonly onboardingTasksService: OnboardingTasksService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-owner')
  confirmOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingTasksService.confirmOwnerIssued(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-employee')
  confirmEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingTasksService.confirmEmployeeReceived(id, user);
  }
}
