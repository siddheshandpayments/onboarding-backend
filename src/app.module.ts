import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    // Loads .env once, makes it available everywhere via ConfigService
    // (no need to re-import ConfigModule in every feature module).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    // Feature modules (AuthModule, UsersModule, TemplatesModule, ...)
    // get added here as later steps build them.
  ],
})
export class AppModule {}
