import type { DriplElement } from '@dripl/common';

/**
 * CSV export — one row per element.
 *
 * The shape is a fixed set of scalar columns that every element carries, plus a single
 * `extra` column holding JSON for everything type-specific. That is a deliberate trade:
 * a fully flattened union of all fields would be directly sortable in a spreadsheet but
 * would be mostly empty cells and a different column count per element type, and a
 * `type`-per-row table cannot be sorted or filtered at all without JSON parsing.
 *
 * `extra` is what makes the export survive extension. `ElementBase` carries a
 * `[key: string]: unknown` index signature for exactly this reason, so any field a
 * plugin or a future element type adds lands in `extra` instead of being dropped — the
 * failure mode of a hard-coded column list is a silently lossy export, not a visible one.
 *
 * Type-specific fields stay in `extra` rather than becoming columns, so `text`,
 * `fontSize`, `points` and friends live there. `text` is the field a reader is most
 * likely to want in a column, and it is the one thing guaranteed to need quoting, since
 * element text contains newlines.
 *
 * **Export-only.** There is no CSV importer, deliberately: a round-trip through a
 * spreadsheet mangles numbers, drops column order, and cannot represent a nested
 * `points` array. Reopening a canvas stays `.dripl`'s job, which carries the full scene
 * including app state.
 */

/** Scalar fields promoted to their own column, in a stable, sortable order. */
export const CSV_COLUMNS = [
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'angle',
  'rotation',
  'opacity',
  'strokeColor',
  'backgroundColor',
  'fillColor',
  'strokeWidth',
  'strokeStyle',
  'fillStyle',
  'roughness',
  'seed',
  'version',
  'versionNonce',
  'updated',
  'isDeleted',
  'locked',
  'groupId',
  'zIndex',
  'fractionalIndex',
  'containerId',
  'labelId',
  'link',
  'flipHorizontal',
  'flipVertical',
] as const;

/** Name of the trailing JSON column. `extra` rather than `metadata`: it is per-element. */
export const EXTRA_COLUMN = 'extra';

const COLUMN_SET: ReadonlySet<string> = new Set<string>(CSV_COLUMNS);

/**
 * Leading characters that make a spreadsheet read a cell as a formula (OWASP's
 * CSV-injection set), and so are the reason a `-` is only matched before a digit or an
 * open paren: a leading hyphen is how people write a bullet ("- item"), and Excel does
 * not treat that as a formula. Matching it anyway would corrupt ordinary text to prevent
 * an attack that does not apply.
 */
const FORMULA_LEAD = /^[=+@\t\r]|^-[0-9(]/;

export interface CsvOptions {
  /**
   * Prefix a leading `=`, `+`, `@`, tab, CR, or numeric `-` in a *string* cell with an
   * apostrophe, so a spreadsheet treats it as text instead of evaluating it. On by
   * default: the failure this prevents is a user's spreadsheet executing a formula that
   * came out of canvas content, which is worse than the handful of cells that gain a
   * leading apostrophe. Numbers are never touched, so a coordinate of `-50` stays `-50`.
   */
  neutraliseFormulas?: boolean;
}

/**
 * Quote a field per RFC 4180: wrap it when it contains a delimiter, a double quote, or a
 * line break, and double any embedded quote.
 */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Neutralised fields are always quoted, and the apostrophe goes *outside* the quotes.
 * Inside them it would be literal text, so `=SUM("a")` would reach the spreadsheet as
 * the string `'=SUM("a")` rather than as a forced-text `=SUM("a")`.
 */
function escapeFormulaField(value: string): string {
  return `"'${value.replace(/"/g, '""')}"`;
}

function escape(value: string, neutralise: boolean): string {
  return neutralise && FORMULA_LEAD.test(value) ? escapeFormulaField(value) : escapeField(value);
}

/**
 * Render one scalar cell. A non-finite number becomes an empty cell rather than the text
 * `NaN`: a spreadsheet would read `NaN` as a string, and an empty cell is at least
 * honestly "no value" instead of a value that looks like data.
 */
function scalarToCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return '';
}

/**
 * Every field that is not a column, as JSON. Keys are sorted so the same element always
 * serialises identically regardless of the order it was built in — otherwise a diff of
 * two exports of an unchanged scene shows spurious changes.
 */
function extraJson(element: DriplElement): string {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(element).sort()) {
    if (COLUMN_SET.has(key)) continue;
    const value = element[key];
    if (value === undefined) continue;
    rest[key] = value;
  }
  return Object.keys(rest).length === 0 ? '' : JSON.stringify(rest);
}

/**
 * The scene as RFC 4180 CSV. CRLF line endings, per the spec, rather than the LF that
 * most JavaScript writers emit — a file opened in Excel is the likely destination, and
 * the spec is the version everybody claims to follow.
 *
 * The `extra` column is not formula-neutralised: it is JSON, so it always begins with
 * `{` and can never begin a formula.
 */
export function buildCsv(elements: DriplElement[], options: CsvOptions = {}): string {
  const { neutraliseFormulas = true } = options;

  const header = [...CSV_COLUMNS, EXTRA_COLUMN].join(',');
  const rows = elements.map(element => {
    const cells = CSV_COLUMNS.map(column => {
      const value = element[column];
      // Only a genuine string can start a formula. `typeof` is the right test here and
      // `Number.isFinite` is not: a coordinate of `-50` must survive as a number.
      const cell = scalarToCell(value);
      return escape(cell, neutraliseFormulas && typeof value === 'string');
    });
    cells.push(escapeField(extraJson(element)));
    return cells.join(',');
  });

  return [header, ...rows].join('\r\n');
}

/**
 * The scene as a downloadable CSV blob.
 *
 * A UTF-8 BOM is prepended because Excel reads a BOM-less UTF-8 file as the system
 * codepage, which mangles any non-ASCII text — and element text is exactly the content a
 * user is most likely to have typed in their own script. The BOM lives here rather than
 * in `buildCsv` so the string builder stays pure and its output is directly assertable.
 */
export function exportToCsv(elements: DriplElement[]): Blob {
  return new Blob(['﻿', buildCsv(elements)], { type: 'text/csv;charset=utf-8' });
}
