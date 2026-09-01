import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiaryController } from './diary.controller';
import { DiaryService } from './diary.service';

@Module({
  imports: [AuthModule],
  controllers: [DiaryController],
  providers: [DiaryService],
})
export class DiaryModule {}
