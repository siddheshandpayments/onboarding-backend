import { IsString, MinLength } from 'class-validator';

export class DeletePostDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
