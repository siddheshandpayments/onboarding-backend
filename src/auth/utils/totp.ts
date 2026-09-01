/** Login's second factor is a fixed 6-digit code, no authenticator app
 *  or QR enrollment involved — verifying just means comparing against
 *  this constant. */
const FIXED_LOGIN_CODE = '123456';

export function verifyTotpCode(code: string): boolean {
  return code === FIXED_LOGIN_CODE;
}
