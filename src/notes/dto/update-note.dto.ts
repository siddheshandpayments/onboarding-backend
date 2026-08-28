import { IsString, MinLength } from 'class-validator';

export class UpdateNoteDto {
  @IsString()
  @MinLength(1)
  content!: string;
}
