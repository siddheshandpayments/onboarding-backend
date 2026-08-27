import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { NewTemplateVersionDto } from './dto/new-template-version.dto';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  // Only SuperAdmin/HR may create or version templates.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post()
  create(@Body() dto: CreateTemplateDto) {
    return this.templatesService.createTemplate(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin_hr')
  @Post(':id/versions')
  createNewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NewTemplateVersionDto,
  ) {
    return this.templatesService.createNewVersion(id, dto);
  }

  // Any authenticated role may read templates — JwtAuthGuard only, no @Roles.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query('departmentId') departmentId?: string) {
    return this.templatesService.listTemplates(departmentId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('active')
  getActiveForDepartment(@Query('departmentId', ParseUUIDPipe) departmentId: string) {
    return this.templatesService.getActiveTemplateForDepartment(departmentId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.getTemplateById(id);
  }
}
