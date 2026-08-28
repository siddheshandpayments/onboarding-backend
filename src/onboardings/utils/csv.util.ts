/**
 * Minimal, dependency-free CSV serializer — one column list, applied
 * consistently, no npm package needed for a handful of columns.
 * Escapes a field only when it actually needs it (contains a comma,
 * quote, or newline), quoting it and doubling any internal quotes per
 * RFC 4180. Dates are serialized as ISO strings; null/undefined become
 * an empty field.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((col) => escapeCsvField(row[col])).join(','));
  return [header, ...lines].join('\r\n');
}
