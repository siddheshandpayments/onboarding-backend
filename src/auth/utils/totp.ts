import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

export interface TotpEnrollmentPayload {
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

/** Generates a fresh TOTP secret + the QR code the user scans into
 *  their authenticator app. Called once at enrollment; the secret is
 *  stored pending until confirmTotpCode() proves the user actually
 *  captured it correctly. */
export async function generateTotpEnrollment(
  accountLabel: string,
  issuer: string,
): Promise<TotpEnrollmentPayload> {
  const secret = authenticator.generateSecret();
  const otpauthUri = authenticator.keyuri(accountLabel, issuer, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);
  return { secret, otpauthUri, qrCodeDataUrl };
}

/** Verifies a 6-digit code against a stored secret. Used both to
 *  confirm enrollment and on every subsequent login. */
export function verifyTotpCode(code: string, secret: string): boolean {
  return authenticator.verify({ token: code, secret });
}
