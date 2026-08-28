import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateEntitlementDto {
  @IsString()
  name!: string;

  @IsIn(['company_wide', 'department'])
  scope!: 'company_wide' | 'department';

  // Cross-field rule (required iff scope === 'department', forbidden
  // otherwise) is enforced in EntitlementsService, not here — same
  // reasoning as OnboardingsService validating department_id manually:
  // a clear BadRequestException message beats leaning on the DB CHECK
  // constraint and surfacing a raw Postgres error to the caller.
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalQuantity?: number;
}
