import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class TemplateTaskInputDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  ownerRole!: string;

  @IsInt()
  @Min(0)
  dueOffsetDays!: number;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsIn(['employee', 'owner', 'dual'])
  completionMode!: 'employee' | 'owner' | 'dual';

  @IsOptional()
  @IsBoolean()
  isCheckpoint?: boolean;

  @IsOptional()
  @IsString()
  milestone?: string;
}
