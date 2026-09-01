import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DiaryService } from './diary.service';
import { UpsertDiaryEntryDto } from './dto/upsert-diary-entry.dto';

// Employee-only, on purpose — this is the one dashboard nobody else,
// not even SuperAdmin/HR, ever gets a read path into. No :userId param
// anywhere, no admin variant, same as NotesService.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('employee')
@Controller('diary')
export class DiaryController {
  constructor(private readonly diaryService: DiaryService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.diaryService.listMine(user.id);
  }

  @Post()
  upsertToday(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertDiaryEntryDto) {
    return this.diaryService.upsertToday(user.id, dto);
  }
}
