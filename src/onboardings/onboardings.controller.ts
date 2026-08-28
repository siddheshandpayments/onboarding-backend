import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
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
}
