import { IsDateString, IsUUID } from 'class-validator';

export class CreateOnboardingDto {
  @IsUUID()
  userId!: string;

  @IsDateString()
  startDate!: string;
}
