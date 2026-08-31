import { IsEmail, IsOptional } from 'class-validator';

/** companyEmail is a manual override — omit it and
 *  OnboardingsService.provisionCompanyEmail auto-generates one via
 *  UsersService.generateUniqueCompanyEmail (name@domain, name1@domain
 *  on collision), which is the normal path. */
export class ProvisionCompanyEmailDto {
  @IsOptional()
  @IsEmail()
  companyEmail?: string;
}
