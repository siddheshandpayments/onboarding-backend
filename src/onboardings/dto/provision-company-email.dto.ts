import { IsEmail } from 'class-validator';

export class ProvisionCompanyEmailDto {
  @IsEmail()
  companyEmail!: string;
}
