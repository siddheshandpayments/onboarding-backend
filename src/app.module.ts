import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { DatabaseModule } from './database/database.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingsModule } from './onboardings/onboardings.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { NotesModule } from './notes/notes.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { CommunityModule } from './community/community.module';
import { DocumentsModule } from './documents/documents.module';

import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [
    // Loads .env once, makes it available everywhere via ConfigService
    // (no need to re-import ConfigModule in every feature module).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    DatabaseModule,
    ActivityLogModule,
    TemplatesModule,
    UsersModule,
    AuthModule,
    OnboardingsModule,
    KnowledgeModule,
    EntitlementsModule,
    NotesModule,
    CommunityModule,
    DocumentsModule,

    // Remaining feature modules get added here as later steps build them.
  ],

  providers: [
    // Step 34:
    // Register the exception filter through APP_FILTER so it works
    // both when the application starts normally through main.ts and
    // when e2e tests create the application through AppModule.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}

