import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // TODO(step 7 RolesGuard): only superadmin_hr may create accounts.
  // Not enforced yet — same gap flagged on TemplatesController.
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  // TODO(step 7 RolesGuard): only superadmin_hr may regenerate credentials.
  @Post('users/:id/regenerate-credentials')
  regenerateCredentials(@Param('id', ParseUUIDPipe) id: string) {
    return this.authService.regenerateCredentials(id);
  }

  // Login (temp_login_email / company_email + password → JWT) is Step 6 —
  // deliberately not built yet, since it needs the JWT strategy that
  // step to set up. This controller so far only covers step 4's scope:
  // credential generation + hashing + reveal-once delivery.
}
