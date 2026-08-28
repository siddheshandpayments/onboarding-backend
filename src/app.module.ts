import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    // Remaining feature modules get added here as later steps build them.
  ],
})
export class AppModule {}
