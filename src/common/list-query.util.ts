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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  limit: number;
  offset: number;
}

/** Step 33: LIMIT/OFFSET on every list endpoint. `limit` defaults to
 *  20, capped at 100 so a client can't force an unbounded scan; `offset`
 *  defaults to 0. Both are validated, not just parsed — a non-integer
 *  or out-of-range value is a 400, same "reject, don't silently
 *  coerce" stance as assertOnlyAllowedKeys above. */
export function parsePagination(query: { limit?: string; offset?: string }): Pagination {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new BadRequestException(`'limit' must be an integer between 1 and ${MAX_LIMIT}`);
    }
    limit = parsed;
  }
  let offset = 0;
  if (query.offset !== undefined) {
    const parsed = Number(query.offset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`'offset' must be a non-negative integer`);
    }
    offset = parsed;
  }
  return { limit, offset };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Every paginated query in this codebase adds `COUNT(*) OVER()::int AS
 * total_count` to its SELECT list — one round trip gets both this
 * page's rows and the total matching count, rather than a separate
 * COUNT query. This strips that pseudo-column back out of each row and
 * wraps the page in a {data, total, limit, offset} envelope, so a
 * caller can tell whether there's more to page through instead of
 * just receiving a silently-truncated list.
 */
export function paginateRows<T extends { total_count?: number }>(
  rows: T[],
  pagination: Pagination,
): PaginatedResult<Omit<T, 'total_count'>> {
  const total = rows[0]?.total_count ?? 0;
  const data = rows.map(({ total_count, ...rest }) => rest);
  return { data, total, limit: pagination.limit, offset: pagination.offset };
}
