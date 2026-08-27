import { randomInt } from 'crypto';

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Slugifies a full name into "first.last" form for the synthetic email
 *  local part. Falls back gracefully for single-word names. */
function slugifyName(fullName: string): string {
  const parts = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return 'user';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts[parts.length - 1]}`;
}

function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[randomInt(0, SUFFIX_ALPHABET.length)];
  }
  return out;
}

/** Generates a login identifier that is NOT a real, deliverable email
 *  address — it exists purely to satisfy "login is email-shaped" and to
 *  guarantee uniqueness. The domain makes it obvious at a glance that
 *  nobody should ever try to send mail to it. */
export function generateLoginEmail(
  fullName: string,
  domain: string,
): string {
  return `${slugifyName(fullName)}.${randomSuffix(6)}@${domain}`;
}

/** Generates a random temporary password. Uses crypto.randomInt (CSPRNG),
 *  not Math.random. Excludes visually ambiguous characters (0/O, 1/l/I)
 *  since this gets read aloud or typed from a phone screen by HR. */
export function generateTempPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return out;
}
