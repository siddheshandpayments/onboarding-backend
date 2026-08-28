import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  create(@Body() dto: CreateOnboardingDto) {
    return this.onboardingsService.createOnboarding(dto);
  }

  // Same privilege level: HR recording the company email is what
  // starts the pre_onboarding -> email_provisioned transition.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post(':id/provision-email')
  provisionEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionCompanyEmailDto,
  ) {
    return this.onboardingsService.provisionCompanyEmail(id, dto);
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

  // "What's stuck": one row per required task that's either blocked or
  // past due on an onboarding that isn't finished yet. A first pass —
  // Step 25/26 (Day 4) formalize overdue detection and polish this
  // into the single-screen view the BRD calls out by name; the overdue
  // condition here (due_date < today, not completed/cancelled) is
  // exactly what that step will reuse, just not extracted yet.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Get('stuck')
  listStuck() {
    return this.onboardingsService.listStuckTasks();
  }
}
