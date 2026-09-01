import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/** A task owner assigning an ad-hoc task onto an onboarding in their
 *  own department — the task-owner-scoped counterpart to HR's
 *  CreateAdHocTaskDto. Simpler on purpose: owner role, completion mode,
 *  and required-ness are all fixed server-side (see
 *  OnboardingTasksService.assignTaskByOwner) rather than caller-supplied. */
export class AssignTaskDto {
  @IsUUID()
  onboardingId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';
}
