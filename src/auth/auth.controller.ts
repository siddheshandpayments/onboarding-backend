import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto, TotpCodeDto, CompletePasswordResetDto } from './dto/totp-and-reset.dto';
import { PreAuthGuard } from './guards/pre-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { PreAuthUser, PreAuthContext } from './decorators/pre-auth-user.decorator';
import { RefreshUser } from './decorators/refresh-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users')
  createUser(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.authService.createUser(dto, actor.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post('users/:id/regenerate-credentials')
  regenerateCredentials(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.regenerateCredentials(id, actor.id);
  }

  // --- Login flow ---
  // Every step below except /login itself requires a valid pre-auth
  // token (Authorization: Bearer <preAuthToken>), obtained from the
  // previous step's response. Identity comes from that token via
  // @PreAuthUser(), never from the request body.

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.loginIdentifier, dto.password);
  }

  @UseGuards(PreAuthGuard)
  @Post('totp/verify')
  verifyTotp(@PreAuthUser() ctx: PreAuthContext, @Body() dto: TotpCodeDto) {
    return this.authService.verifyTotpForLogin(ctx.userId, dto.code);
  }

  @UseGuards(PreAuthGuard)
  @Post('first-login/complete-password')
  completeFirstLoginPasswordReset(
    @PreAuthUser() ctx: PreAuthContext,
    @Body() dto: CompletePasswordResetDto,
  ) {
    return this.authService.completeFirstLoginPasswordReset(
      ctx.userId,
      dto.newPassword,
      ctx.totpVerified,
    );
  }

  @UseGuards(PreAuthGuard)
  @Post('company-email/complete-password')
  completeCompanyEmailPasswordReset(
    @PreAuthUser() ctx: PreAuthContext,
    @Body() dto: CompletePasswordResetDto,
  ) {
    return this.authService.completeCompanyEmailPasswordReset(
      ctx.userId,
      dto.newPassword,
      ctx.totpVerified,
    );
  }

  // --- Token refresh ---
  @UseGuards(RefreshGuard)
  @Post('refresh')
  refresh(@RefreshUser() userId: string) {
    return this.authService.refreshAccessToken(userId);
  }
}
