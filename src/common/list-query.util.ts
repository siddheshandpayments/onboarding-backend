import { BadRequestException } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Step 32: "reject any non-allow-listed field" means exactly that — a
 * typo'd or probing filter/sort name is a 400, not a silently ignored
 * key that leaves the caller thinking they filtered when they didn't.
 * Every list endpoint below calls this against the FULL query object
 * (@Query() with no key, not @Query('name')) before reading any
 * individual field off it.
 */
export function assertOnlyAllowedKeys(
  query: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const unknown = Object.keys(query).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unsupported query parameter(s): ${unknown.join(', ')}. Allowed: ${allowedKeys.join(', ')}`,
    );
  }
}

export function assertUuidIfPresent(value: string | undefined, fieldName: string): void {
  if (value !== undefined && !UUID_RE.test(value)) {
    throw new BadRequestException(`'${fieldName}' must be a UUID`);
  }
}

export function assertDateIfPresent(value: string | undefined, fieldName: string): void {
  if (value !== undefined && !DATE_RE.test(value)) {
    throw new BadRequestException(`'${fieldName}' must be a date in YYYY-MM-DD form`);
  }
}

export function assertOneOfIfPresent(
  value: string | undefined,
  fieldName: string,
  allowedValues: readonly string[],
): void {
  if (value !== undefined && !allowedValues.includes(value)) {
    throw new BadRequestException(`'${fieldName}' must be one of: ${allowedValues.join(', ')}`);
  }
}

/**
 * `sort=field` (ascending) or `sort=-field` (descending — leading '-',
 * a common compact convention). Falls back to defaultField/ascending
 * when absent. The returned `field` is guaranteed to be a member of
 * `allowedFields`, so callers can safely use it as a key into their
 * own fixed field->SQL-expression map — never interpolate it, or the
 * raw sortParam, directly into a query string.
 */
export function parseSort(
  sortParam: string | undefined,
  allowedFields: readonly string[],
  defaultField: string,
): { field: string; direction: 'ASC' | 'DESC' } {
  if (!sortParam) {
    return { field: defaultField, direction: 'ASC' };
  }
  const descending = sortParam.startsWith('-');
  const field = descending ? sortParam.slice(1) : sortParam;
  if (!allowedFields.includes(field)) {
    throw new BadRequestException(
      `Unsupported sort field '${field}'. Allowed: ${allowedFields.join(', ')} (prefix with '-' to sort descending)`,
    );
  }
  return { field, direction: descending ? 'DESC' : 'ASC' };
}
