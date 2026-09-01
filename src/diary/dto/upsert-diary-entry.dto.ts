import { IsString, MinLength } from 'class-validator';

export class UpsertDiaryEntryDto {
  @IsString()
  @MinLength(1)
  content!: string;
}
