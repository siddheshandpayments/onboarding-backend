import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import {
  VerifyPasswordDto,
  TotpEnrollDto,
  TotpConfirmDto,
  CompletePasswordResetDto,
} from './dto/totp-and-reset.dto';

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

  // --- Step 5: password + TOTP state machine ---
  // TODO(step 6): these should be chained behind a short-lived pre-auth
  // token issued by verify-password, not a raw userId in every body.
  // Anyone who learns a userId can currently call the TOTP/reset
  // endpoints for it — real gap, tracked, not yet closed.

  @Post('login/verify-password')
  verifyPassword(@Body() dto: VerifyPasswordDto) {
    return this.authService.verifyPassword(dto.loginIdentifier, dto.password);
  }

  @Post('totp/enroll')
  startTotpEnrollment(@Body() dto: TotpEnrollDto) {
    return this.authService.startTotpEnrollment(dto.userId);
  }

  @Post('totp/enroll/confirm')
  confirmTotpEnrollment(@Body() dto: TotpConfirmDto) {
    return this.authService.confirmTotpEnrollment(dto.userId, dto.code);
  }

  @Post('totp/verify')
  verifyTotp(@Body() dto: TotpConfirmDto) {
    return this.authService.verifyTotpForLogin(dto.userId, dto.code);
  }

  @Post('first-login/complete-password')
  completeFirstLoginPasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.authService.completeFirstLoginPasswordReset(
      dto.userId,
      dto.newPassword,
    );
  }

  @Post('company-email/complete-password')
  completeCompanyEmailPasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.authService.completeCompanyEmailPasswordReset(
      dto.userId,
      dto.newPassword,
    );
  }

  // Full login (Step 6) chains verify-password → totp/enroll or
  // totp/verify → issues JWT access + refresh tokens. Not built yet —
  // this controller so far covers steps 4 & 5's scope only.
}

