import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { parsePagination } from '../common/list-query.util';

// Every route is scoped to the caller's own id via @CurrentUser() —
// there is no :userId param anywhere on this controller, and no
// @Roles() either, with one deliberate exception: 'admin/all' below,
// which reads note CONTENT company-wide for SuperAdmin/HR but never
// touches user_id — see NotesService.listAllForAdmin. Ownership is
// still absolute for every other route, including superadmin_hr.
@UseGuards(JwtAuthGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteDto) {
    return this.notesService.createNote(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notesService.listNotes(user.id, parsePagination({ limit, offset }));
  }

  // Declared before ':id' so 'admin/all' is never captured as an id
  // param. Content only, no author — see NotesService.listAllForAdmin.
  @UseGuards(RolesGuard)
  @Roles('superadmin_hr')
  @Get('admin/all')
  listAllForAdmin(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.notesService.listAllForAdmin(parsePagination({ limit, offset }));
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notesService.getNote(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notesService.updateNote(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notesService.deleteNote(user.id, id);
  }
}
