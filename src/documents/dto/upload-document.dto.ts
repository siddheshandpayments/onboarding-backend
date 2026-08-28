import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @MinLength(1)
  title!: string;

  // NULL = company-wide, matching documents.department_id's own
  // schema comment. Omit the field entirely for a company-wide doc.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
