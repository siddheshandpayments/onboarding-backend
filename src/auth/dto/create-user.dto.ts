import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsString()
  fullName!: string;

  @IsString()
  phoneNumber!: string;

  @IsIn(['superadmin_hr', 'task_owner', 'employee'])
  role!: 'superadmin_hr' | 'task_owner' | 'employee';

  // Required for employees (drives their onboarding's department),
  // optional for SuperAdmin/HR/TaskOwner accounts.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
