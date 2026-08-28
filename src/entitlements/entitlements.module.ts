import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
})
export class EntitlementsModule {}
