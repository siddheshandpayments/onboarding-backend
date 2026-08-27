import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './tokens/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PreAuthGuard } from './guards/pre-auth.guard';
import { RefreshGuard } from './guards/refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // No default secret/expiry registered here on purpose — TokenService
    // passes secret + expiresIn explicitly per call, since access,
    // refresh, and pre-auth tokens each need their own.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    PreAuthGuard,
    RefreshGuard,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
