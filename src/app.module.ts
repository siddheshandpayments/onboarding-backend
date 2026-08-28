import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingsModule } from './onboardings/onboardings.module';

@Module({
  imports: [
    // Loads .env once, makes it available everywhere via ConfigService
    // (no need to re-import ConfigModule in every feature module).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    TemplatesModule,
    UsersModule,
    AuthModule,
    OnboardingsModule,
    // Remaining feature modules (KnowledgeModule, ...) get added here
    // as later steps build them.
  ],
})
export class AppModule {}
