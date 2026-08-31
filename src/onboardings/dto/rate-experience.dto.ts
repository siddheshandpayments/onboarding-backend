import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RateExperienceDto {
  @IsIn([1, 2, 3, 4, 5])
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
