import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MulterModule.registerAsync({
      useFactory: (config: ConfigService) => {
        const uploadsDir = config.get<string>('UPLOADS_DIR') ?? './uploads';
        mkdirSync(uploadsDir, { recursive: true });
        return {
          storage: diskStorage({
            destination: uploadsDir,
            // Server-generated filename, never the client-supplied
            // original — see DocumentsService's comment on file_url.
            filename: (_req, file, cb) => {
              cb(null, `${randomUUID()}${extname(file.originalname)}`);
            },
          }),
          limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
