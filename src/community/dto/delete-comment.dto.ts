import { IsString, MinLength } from 'class-validator';

export class DeleteCommentDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
