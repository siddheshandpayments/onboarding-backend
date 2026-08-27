import {
  ArrayMinSize,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateTaskInputDto } from './template-task-input.dto';

export class CreateTemplateDto {
  @IsUUID()
  departmentId!: string;

  @IsString()
  name!: string;

  @ValidateNested({ each: true })
  @Type(() => TemplateTaskInputDto)
  @ArrayMinSize(1)
  tasks!: TemplateTaskInputDto[];
}
