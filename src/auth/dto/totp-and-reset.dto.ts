import { IsString, IsUUID, Length } from 'class-validator';

export class VerifyPasswordDto {
  @IsString()
  loginIdentifier!: string; // temp_login_email OR company_email

  @IsString()
  password!: string;
}

export class TotpEnrollDto {
  // TODO(step 6): replace with the authenticated user's id from a
  // verified pre-auth token instead of trusting a client-supplied id.
  @IsUUID()
  userId!: string;
}

export class TotpConfirmDto extends TotpEnrollDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class CompletePasswordResetDto extends TotpEnrollDto {
  @IsString()
  @Length(8, 100)
  newPassword!: string;
}
