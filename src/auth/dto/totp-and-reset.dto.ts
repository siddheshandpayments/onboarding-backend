import { IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  loginIdentifier!: string; // temp_login_email OR company_email

  @IsString()
  password!: string;
}

// userId is intentionally NOT a field on any of these anymore — it comes
// from the verified pre-auth token via @PreAuthUser(), attached by
// PreAuthGuard. See Step 6.

export class TotpCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class CompletePasswordResetDto {
  @IsString()
  @Length(8, 100)
  newPassword!: string;
}
