import { IsString, MinLength } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MinLength(1)
  body!: string;
}
