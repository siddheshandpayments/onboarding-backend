import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { resolve } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // Only SuperAdmin/HR upload company documents.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.createDocument(
      actor.id,
      dto.title,
      dto.departmentId ?? null,
      file.filename,
    );
  }

  // Any authenticated user — scoped server-side to company-wide docs
  // plus their own department, see DocumentsService.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.documentsService.listVisibleForActor(actor.id);
  }

  // Streams the file through the app rather than a static file route,
  // so the same department-scoping applies to downloads as to listing
  // — a direct /uploads/<filename> URL is never exposed to clients.
  @UseGuards(JwtAuthGuard)
  @Get(':id/download')
  async download(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { title, storedFilename } = await this.documentsService.getDownloadableOrThrow(
      id,
      actor.id,
    );
    const absolutePath = resolve(this.documentsService.getUploadsDir(), storedFilename);

    res.download(absolutePath, title, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ statusCode: 404, message: 'File not found on disk' });
      }
    });
  }
}
