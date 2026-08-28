import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingsService } from './onboardings.service';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ProvisionCompanyEmailDto } from './dto/provision-company-email.dto';

@Controller('onboardings')
export class OnboardingsController {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  // Only SuperAdmin/HR add joiners — same privilege level as creating
  // the user account in the first place (AuthController.createUser).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.createOnboarding(dto, actor.id);
  }

  // Same privilege level: HR recording the company email is what
  // starts the pre_onboarding -> email_provisioned transition.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post(':id/provision-email')
  provisionEmail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionCompanyEmailDto,
  ) {
    return this.onboardingsService.provisionCompanyEmail(id, dto, actor.id);
  }

  // HR/SuperAdmin dashboard: every onboarding, company-wide. Basic
  // equality filters only for now — Step 32 (Day 5) adds the shared
  // allow-listed filter/sort/pagination machinery across list
  // endpoints; this doesn't try to anticipate that.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get()
  listAll(
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
  ) {
    return this.onboardingsService.listAllOnboardings({ departmentId, status });
  }

  // Step 26: the single-screen "what's stuck" view (BRD M6). One row
  // per required task that's either blocked or overdue (Step 25's
  // shared isOverdueSql(), which excludes locked tasks so a checkpoint
  // waiting on confirmation shows up once, not as a flood of its
  // blocked-behind-it phase-2 tasks) on an onboarding that isn't
  // finished yet.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('stuck')
  listStuck() {
    return this.onboardingsService.listStuckTasks();
  }

  // Step 21: Employee dashboard. Scoped server-side to the caller's
  // own onboarding (OnboardingsService.findByUserId(actor.id)) — never
  // an id from the URL or query string, so there's no path to another
  // employee's onboarding here at all, not even a hidden one.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('employee')
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingsService.getMyDashboard(user);
  }
}
