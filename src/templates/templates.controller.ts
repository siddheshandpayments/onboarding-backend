import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  // TODO(step 4-7): import JwtAuthGuard, RolesGuard, Roles decorator once AuthModule exists.
  // UseGuards,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { NewTemplateVersionDto } from './dto/new-template-version.dto';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  // TODO(step 4-7): @UseGuards(JwtAuthGuard, RolesGuard) @Roles('superadmin_hr')
  // Only SuperAdmin/HR may create or version templates — not enforced yet.
  @Post()
  create(@Body() dto: CreateTemplateDto) {
    return this.templatesService.createTemplate(dto);
  }

  // TODO(step 4-7): same guard as above.
  @Post(':id/versions')
  createNewVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NewTemplateVersionDto,
  ) {
    return this.templatesService.createNewVersion(id, dto);
  }

  // TODO(step 4-7): any authenticated role may read templates; add JwtAuthGuard only, no @Roles.
  @Get()
  list(@Query('departmentId') departmentId?: string) {
    return this.templatesService.listTemplates(departmentId);
  }

  @Get('active')
  getActiveForDepartment(@Query('departmentId', ParseUUIDPipe) departmentId: string) {
    return this.templatesService.getActiveTemplateForDepartment(departmentId);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.getTemplateById(id);
  }
}
