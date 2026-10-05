import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { buildCsv, exportToCsv, CSV_COLUMNS, EXTRA_COLUMN } from '@/utils/export/csv';
import type { CsvOptions } from '@/utils/export/csv';
import { exportCanvas } from '@/utils/export/serialization';

/**
 * `utils/export/csv.ts` — the CSV half of "export this canvas".
 *
 * The interesting claim this file makes is not "it produces a CSV" but that it
 * produces one a spreadsheet will read back the same way. Every assertion here is
 * therefore made through a real RFC 4180 reader (below) rather than through
 * `split(',')`, because `split(',')` is precisely the mistake the escaping
 * behaviour exists to prevent: an element whose text contains a newline makes one
 * logical row look like two, and an un-doubled quote makes a two-field row look
 * like four. A parser-based count is the only way to see either.
 *
 * The second theme is `extra`: `ElementBase` carries `[key: string]: unknown`, and
 * the export's stated failure mode is a *silently* lossy one. So the tests assert
 * that unknown fields survive, that their serialisation is order-independent, and
 * that the cells which can reach a spreadsheet as a formula are neutralised —
 * including, and separately, the ones that must not be.
 */

/* ------------------------------------------------------------------ *
 * A minimal RFC 4180 reader.
 * ------------------------------------------------------------------ */

/**
 * Raised for a document that violates RFC 4180, rather than being silently
 * repaired. A lenient reader cannot be used to catch a mis-escaped field, which
 * is the entire reason for reading the export back instead of matching strings.
 */
class Rfc4180Error extends Error {}

/** One field as it was written (`raw`) and as a reader recovers it (`value`). */
interface CsvField {
  /** The field exactly as it appears between its delimiters. */
  readonly raw: string;
  /** The unescaped value: doubled quotes collapsed, surrounding quotes removed. */
  readonly value: string;
}

type CsvRecord = readonly CsvField[];
type CsvDocument = readonly CsvRecord[];

/**
 * Parse `text` into records of fields, keeping both the written form and the
 * recovered value.
 *
 * Both halves are needed. `value` is what a spreadsheet sees, so it is what every
 * round-trip assertion compares against. `raw` is the only way to assert the
 * escaping *mechanism* — that a neutralised field is quoted with the apostrophe
 * outside the quotes rather than inside them, which is invisible once a reader has
 * stripped the quoting.
 *
 * Deliberately strict in the three places a naive writer breaks, so that a
 * document produced by a broken escaper fails loudly instead of parsing into
 * plausible-looking nonsense:
 *
 * - a `"` may only open a field, never appear inside an unquoted one;
 * - inside a quoted field `""` is a literal quote and the next `"` closes it;
 * - a closing `"` may only be followed by a delimiter, a record separator, or EOF.
 *
 * A bare `\n` is accepted as a record separator so that a writer emitting LF
 * instead of CRLF still parses — the line-ending requirement is asserted
 * separately and exactly, rather than smuggled in here as a parse failure.
 */
function parseCsvFields(text: string): CsvDocument {
  const records: CsvRecord[] = [];
  let record: CsvField[] = [];
  let field = '';
  let raw = '';
  let quoted = false;
  let index = 0;

  const endField = () => {
    record.push({ raw, value: field });
    field = '';
    raw = '';
  };
  const endRecord = () => {
    record.push({ raw, value: field });
    records.push(record);
    record = [];
    field = '';
    raw = '';
  };

  while (index < text.length) {
    const char = text[index]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
        raw += char;
        index += 1;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        raw += '""';
        index += 2;
        continue;
      }
      quoted = false;
      index += 1;
      raw += '"';
      const next = text[index];
      if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
        throw new Rfc4180Error(`unexpected ${JSON.stringify(next)} after a closing quote`);
      }
      continue;
    }

    if (char === '"') {
      if (field !== '') {
        throw new Rfc4180Error('a quote may only open a field, not appear inside one');
      }
      quoted = true;
      raw += '"';
      index += 1;
      continue;
    }

    if (char === ',') {
      endField();
      index += 1;
      continue;
    }

    if (char === '\r' || char === '\n') {
      // CRLF is consumed as one separator; a bare CR or LF stands alone.
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      index += 1;
      endRecord();
      continue;
    }

    field += char;
    raw += char;
    index += 1;
  }

  if (quoted) throw new Rfc4180Error('unterminated quoted field');
  // A trailing separator ends a record; nothing pending means no extra record.
  if (field !== '' || raw !== '' || record.length > 0) endRecord();

  return records;
}

/** The recovered values only, for when the written form is not what is under test. */
function parseCsv(text: string): string[][] {
  return parseCsvFields(text).map(record => record.map(field => field.value));
}

/* ------------------------------------------------------------------ *
 * Fixtures and readers.
 * ------------------------------------------------------------------ */

/** U+FEFF, spelled out so the BOM assertions do not depend on an invisible char. */
const BOM = '﻿';

/**
 * A rectangle carrying the six required fields and nothing else, so every test
 * varies exactly one thing. The `as unknown as` hop is what lets a fixture put a
 * value a column's declared type forbids into that column — which is reachable in
 * production through the same `[key: string]: unknown` signature `extra` exists
 * for, and is the only way to reach the non-scalar branches of `scalarToCell`.
 */
const rect = (over: Record<string, unknown> = {}): DriplElement =>
  ({
    id: 'e1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...over,
  }) as unknown as DriplElement;

/**
 * A text element. `text` is deliberately *not* a column: it reaches the file
 * through `extra`, which is what makes the comma/quote/newline fixture below a
 * test of the JSON column's escaping rather than of a plain string cell.
 */
const textElement = (text: string, over: Record<string, unknown> = {}): DriplElement =>
  rect({ type: 'text', text, originalText: text, fontSize: 20, ...over });

/** `CSV_COLUMNS` plus `extra`, which is the header every export must open with. */
const HEADER = [...CSV_COLUMNS, EXTRA_COLUMN];

/** Position of a named column in a data row. `extra` is addressable too. */
const columnAt = (name: string): number => {
  const index = CSV_COLUMNS.indexOf(name as (typeof CSV_COLUMNS)[number]);
  if (index !== -1) return index;
  if (name === EXTRA_COLUMN) return CSV_COLUMNS.length;
  throw new Error(`${name} is neither a column nor the extra column`);
};

const EXTRA_AT = CSV_COLUMNS.length;

/**
 * Read a blob's bytes as text, keeping any BOM.
 *
 * `Blob.text()` and `FileReader.readAsText` both *strip* a leading BOM during
 * decoding, so neither can see the character this file asserts on. The bytes are
 * read as an array buffer and decoded with `ignoreBOM: true`, which is the only
 * way to observe the BOM as a character. (`Blob.text()` is also absent from jsdom's
 * `Blob` entirely.) The assertions still go through the blob's own bytes rather
 * than any internal state the exporter keeps.
 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // `reader.result` is already the ArrayBuffer here; there is no `.buffer` to
      // unwrap, and unwrapping one anyway is how a decode silently receives
      // `undefined` and produces an empty string.
      resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Parsed records of a pure `buildCsv` output, values only. */
const records = (csv: string): string[][] => parseCsv(csv);

/** One element's row, both as written and as recovered. */
const rowOf = (element: DriplElement, options?: CsvOptions): CsvRecord => {
  const parsed = parseCsvFields(buildCsv([element], options));
  expect(parsed).toHaveLength(2);
  return parsed[1]!;
};

/** The JSON in `extra` for one element, parsed. */
const extraOf = (element: DriplElement, options?: CsvOptions): Record<string, unknown> => {
  const value = rowOf(element, options)[EXTRA_AT]!.value;
  return JSON.parse(value) as Record<string, unknown>;
};

/** The field for one column of one element, as it was written. */
const rawCell = (element: DriplElement, column: string, options?: CsvOptions): string =>
  rowOf(element, options)[columnAt(column)]!.raw;

/** The value a reader recovers for one column of one element. */
const cell = (element: DriplElement, column: string, options?: CsvOptions): string =>
  rowOf(element, options)[columnAt(column)]!.value;

/** Number of CRLF separators — the record count minus one, for a clean document. */
const crlfCount = (text: string): number => text.split('\r\n').length - 1;

/** LF characters that are not part of a CRLF. */
const bareLfCount = (text: string): number => text.replaceAll('\r\n', '').split('\n').length - 1;

/**
 * Every string column an exporter has to be able to quote correctly.
 *
 * No one of these realistically holds a newline or a formula — element text does,
 * and it reaches the file as JSON inside `extra`. The quoting and neutralisation
 * rules are column-agnostic, so the fixtures below drive them through these
 * columns: the point is to pin the rule for a raw string cell, and the raw string
 * cell is the only place the rule is observable at all.
 */
const STRING_COLUMNS = ['id', 'strokeColor', 'groupId', 'link'] as const;

/* ------------------------------------------------------------------ *
 * The reader itself.
 * ------------------------------------------------------------------ */

describe('the RFC 4180 reader used by this file', () => {
  it('reads a bare document', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects a quote inside an unquoted field, which is how a missing escape shows up', () => {
    // The negative control for every escaping assertion below. Without this, a
    // reader that quietly accepted `ab"c"` would make those assertions vacuous:
    // a writer that stopped doubling quotes would still parse into the same cells.
    // Two shapes, because there are two places a stray quote can land.
    expect(() => parseCsv('ab"c",d')).toThrow(Rfc4180Error);
    expect(() => parseCsv('a,"b"c,d')).toThrow(Rfc4180Error);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a,"b')).toThrow(Rfc4180Error);
  });

  it('un-escapes a doubled quote, so quoting is not lossy', () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']]);
  });
});

/* ------------------------------------------------------------------ *
 * Column list.
 * ------------------------------------------------------------------ */

describe('CSV_COLUMNS and EXTRA_COLUMN', () => {
  it('opens with the column list followed by extra, in order', () => {
    // Derived from the exported list rather than typed out, so the header cannot
    // drift from the columns: a header written as a literal would keep passing
    // after a column was added or reordered.
    expect(buildCsv([])).toBe(HEADER.join(','));
  });

  it('lists no column twice, which would make the header and the cells disagree', () => {
    const seen = new Set<string>(CSV_COLUMNS);
    expect(seen.size).toBe(CSV_COLUMNS.length);
  });

  it('does not include extra among the columns', () => {
    // If it did, `extraJson` would filter the field it is about to write out.
    expect(CSV_COLUMNS).not.toContain(EXTRA_COLUMN);
  });

  it('gives every element exactly one cell per column plus extra', () => {
    const csv = buildCsv([rect({ id: 'a' }), rect({ id: 'b' }), textElement('hi', { id: 'c' })]);
    const parsed = records(csv);

    expect(parsed).toHaveLength(4);
    for (const record of parsed) expect(record).toHaveLength(HEADER.length);
  });
});

/* ------------------------------------------------------------------ *
 * Escaping.
 * ------------------------------------------------------------------ */

describe('buildCsv — RFC 4180 escaping', () => {
  it('quotes a field holding a comma, a quote and a newline, and keeps it one field', () => {
    // The case a naive writer loses: `extra` is JSON, and JSON of this text
    // contains literal commas and a literal `"`. If the field were emitted raw,
    // `split(',')` would report extra commas, and if the `"` were not doubled the
    // reader would treat the rest of the row as data. Both are caught here
    // because the field count is compared against the header, not against a guess.
    const element = textElement('He said "hi",\nthen left');
    const csv = buildCsv([element]);
    const parsed = records(csv);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(HEADER);
    expect(parsed[1]).toHaveLength(HEADER.length);
    // And the value survives intact, which is the point of quoting it at all.
    expect(extraOf(element)['text']).toBe('He said "hi",\nthen left');
    // The embedded newline must not have started a record of its own.
    expect(crlfCount(csv)).toBe(1);
  });

  it('keeps a raw CR or LF inside a quoted cell rather than starting a new record', () => {
    // `extra` can never carry this — `JSON.stringify` escapes newlines — so the
    // only way a raw line break reaches a cell is a string column. This is the
    // assertion that would notice if the newline check were dropped from the
    // escaping rule, which `split(',')`-based counting could not see.
    for (const brk of ['\n', '\r\n', '\r']) {
      const element = rect({ strokeColor: `a${brk}b` });
      const csv = buildCsv([element]);
      const parsed = records(csv);

      expect(parsed).toHaveLength(2);
      expect(parsed[1]).toHaveLength(HEADER.length);
      expect(cell(element, 'strokeColor')).toBe(`a${brk}b`);
    }
  });

  it('leaves an ordinary field unquoted, so the common case stays readable', () => {
    // A bare rectangle with no non-column fields produces a row with no quotes at
    // all: every cell is empty or a plain token, and `extra` is empty rather than
    // `{}`. Quoting indiscriminately would still parse correctly, so this asserts
    // the trade-off (no gratuitous quoting) rather than the absence of a bug.
    const csv = buildCsv([rect({ id: 'plain' })]);
    const row = records(csv)[1]!;

    expect(row[0]).toBe('plain');
    // Not one quote character in the whole document: `extra` is empty rather than
    // `{}`, and nothing needed quoting. Quoting indiscriminately would still parse
    // correctly, so this asserts the readability trade-off, not the absence of a bug.
    expect(csv).not.toContain('"');
    expect(crlfCount(csv)).toBe(1);
  });

  it('separates records with CRLF, never a bare LF', () => {
    // Per the spec rather than the LF most JavaScript writers emit. Both halves
    // are asserted: a document that used LF would still parse, so only the exact
    // count notices.
    const csv = buildCsv([rect({ id: 'a' }), rect({ id: 'b' }), rect({ id: 'c' })]);

    expect(crlfCount(csv)).toBe(3);
    expect(bareLfCount(csv)).toBe(0);
    expect(csv.startsWith(`${HEADER.join(',')}\r\n`)).toBe(true);
  });

  it('writes no trailing record break', () => {
    // Derived from the record count: a trailing separator would show up as one
    // more CRLF than there are records past the header.
    const csv = buildCsv([rect({ id: 'a' }), rect({ id: 'b' })]);

    expect(crlfCount(csv)).toBe(2);
    expect(csv.endsWith('\r\n')).toBe(false);
  });

  it('emits the header alone for an empty scene', () => {
    // No data rows, and no blank row either — an extra blank row is what an
    // implementation that joins `[header, '']` produces.
    const parsed = records(buildCsv([]));

    expect(parsed).toEqual([HEADER]);
    expect(crlfCount(buildCsv([]))).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The extra column.
 * ------------------------------------------------------------------ */

describe('buildCsv — the extra column', () => {
  it('collects every field that is not a column, including unknown ones', () => {
    // The index signature is the whole reason `extra` exists. A field no column
    // knows about has to survive, or the export is silently lossy.
    const element = rect({
      text: 'kept',
      fontSize: 32,
      points: [
        [0, 0],
        [1, 1],
      ],
      customFlag: true,
      nested: { deep: { deeper: 1 } },
    });

    expect(extraOf(element)).toEqual({
      text: 'kept',
      fontSize: 32,
      points: [
        [0, 0],
        [1, 1],
      ],
      customFlag: true,
      nested: { deep: { deeper: 1 } },
    });
  });

  it('never repeats a column as JSON', () => {
    // If a column also appeared in `extra`, every element would carry its own
    // `x` twice in two different formats and the file would stop being a table.
    // An element whose fields are all columns has nothing left for `extra`, and a
    // column filter that stopped filtering would show up here as a populated cell.
    const allColumns = rect({
      id: 'a',
      x: -50,
      locked: true,
      strokeColor: '#fff',
      fractionalIndex: 'a1',
    });

    expect(rowOf(allColumns)[EXTRA_AT]!.value).toBe('');

    // And the other direction: for a row that does have extras, no column name
    // appears as a JSON key. Checked against the exported list, so adding a column
    // extends the check.
    const withExtra = rowOf(rect({ id: 'a', x: -50, fontSize: 12 }))[EXTRA_AT]!.value;

    expect(JSON.parse(withExtra) as object).toEqual({ fontSize: 12 });
    for (const column of CSV_COLUMNS) expect(withExtra).not.toContain(`"${column}":`);
  });

  it('writes an empty cell when an element has no non-column fields', () => {
    // `''` rather than `{}`: an empty cell reads as "nothing extra", which is what
    // it is, and it keeps the row free of quotes for the common rectangle.
    const row = rowOf(rect({ id: 'a' }));

    expect(row[EXTRA_AT]!.raw).toBe('');
    expect(row[EXTRA_AT]!.value).toBe('');
  });

  it('sorts its keys, so the same element serialises identically whatever order it was built in', () => {
    // Two elements with identical content and opposite key insertion order. The
    // export has to be byte-identical, not merely equal after parsing, because the
    // stated cost of not sorting is a spurious diff between two exports of an
    // unchanged scene — which is invisible to any assertion that parses first.
    const forward = Object.fromEntries([
      ['id', 'e1'],
      ['type', 'rectangle'],
      ['x', 1],
      ['y', 2],
      ['width', 3],
      ['height', 4],
      ['zeta', 'z'],
      ['alpha', 'a'],
      ['mid', 'm'],
    ]) as unknown as DriplElement;
    const backward = Object.fromEntries(
      [...Object.entries(forward)].reverse()
    ) as unknown as DriplElement;

    expect(Object.keys(forward)).not.toEqual(Object.keys(backward));
    expect(buildCsv([forward])).toBe(buildCsv([backward]));
    // Spelled out so the guarantee is visible, not just implied by the equality:
    // the keys are in ascending order, not insertion order, not column order.
    expect(Object.keys(JSON.parse(rowOf(forward)[EXTRA_AT]!.value) as object)).toEqual([
      'alpha',
      'mid',
      'zeta',
    ]);
  });

  it('omits a field whose value is undefined, and empties the cell when nothing is left', () => {
    // `JSON.stringify` drops undefined-valued keys on its own, so the only
    // observable difference is the cell itself: without the skip, an element whose
    // only extra field is `undefined` would serialise as `{}` instead of empty.
    const onlyUndefined = rect({ note: undefined, other: 1 });

    expect(extraOf(onlyUndefined)).toEqual({ other: 1 });
    expect(onlyUndefined).toHaveProperty('note');
    expect(rowOf(rect({ note: undefined }))[EXTRA_AT]!.value).toBe('');
  });

  it('keeps a field whose value is null, which is not the same as absent', () => {
    // `roundness` is `null` on a plain rectangle by design, so dropping nulls
    // would quietly lose a field the element really has.
    expect(extraOf(rect({ roundness: null }))).toEqual({ roundness: null });
  });

  it('is never formula-neutralised, because JSON always starts with a brace', () => {
    // A text element whose text is itself a formula is the only way an `extra` cell
    // could start with `=`. It must arrive as JSON, unprefixed, so a spreadsheet
    // sees one JSON cell rather than text plus a stray apostrophe.
    const element = textElement('=1+1');

    expect(cell(element, EXTRA_COLUMN)).not.toContain("'");
    expect(rawCell(element, EXTRA_COLUMN)).toContain('{');
    expect(extraOf(element)['text']).toBe('=1+1');
  });
});

/* ------------------------------------------------------------------ *
 * Scalar cells.
 * ------------------------------------------------------------------ */

describe('buildCsv — scalar cells', () => {
  it('renders a non-finite number as an empty cell, not as NaN or Infinity', () => {
    // An empty cell is at least honestly "no value"; the text `NaN` would read as
    // data. `-Infinity` is included because it is the one that also starts with a
    // character the formula rule cares about — a number, so it must be left to the
    // finite check alone.
    const nonFinite = [
      { value: Number.NaN, why: 'NaN' },
      { value: Number.POSITIVE_INFINITY, why: '+Infinity' },
      { value: Number.NEGATIVE_INFINITY, why: '-Infinity, which also leads with -' },
    ];

    for (const { value, why } of nonFinite) {
      const element = rect({ x: value, y: value, width: value, height: value });
      const row = rowOf(element);

      expect(
        row.slice(columnAt('x'), columnAt('height') + 1).map(f => f.value),
        why
      ).toEqual(['', '', '', '']);
      // Not the text `NaN`/`Infinity`, anywhere in the row: an empty cell is
      // honestly "no value", whereas the text would read as data.
      expect(buildCsv([element]), why).not.toMatch(/NaN|Infinity/);
      // The present id proves the row is intact rather than short.
      expect(row[0]!.value).toBe('e1');
    }
  });

  it('renders a boolean as true or false', () => {
    const element = rect({ locked: true, isDeleted: false, flipHorizontal: 1 });

    expect(cell(element, 'locked')).toBe('true');
    expect(cell(element, 'isDeleted')).toBe('false');
    // A numeric flag stays numeric rather than becoming "1" by coercion.
    expect(cell(element, 'flipHorizontal')).toBe('1');
  });

  it('renders undefined and null as empty cells', () => {
    const element = rect({ groupId: undefined, link: null, strokeColor: '#000' });

    expect(cell(element, 'groupId')).toBe('');
    expect(cell(element, 'link')).toBe('');
    // The present sibling proves the emptiness is about the value, not the column.
    expect(cell(element, 'strokeColor')).toBe('#000');
  });

  it('renders a non-scalar as an empty cell rather than [object Object]', () => {
    // Reachable through the index signature. `String({})` would put
    // `[object Object]` in a numeric column, which is worse than an empty cell:
    // it looks like a value.
    const element = rect({ x: { a: 1 }, y: [1, 2], width: () => 1, height: Symbol('s') });

    expect(
      rowOf(element)
        .slice(columnAt('x'), columnAt('height') + 1)
        .map(f => f.value)
    ).toEqual(['', '', '', '']);
    expect(buildCsv([element])).not.toContain('[object Object]');
  });
});

/* ------------------------------------------------------------------ *
 * Formula neutralisation.
 * ------------------------------------------------------------------ */

describe('buildCsv — formula neutralisation', () => {
  it('prefixes a leading =, +, @, tab or CR with an apostrophe outside the quotes', () => {
    // One assertion per lead character, because the regex is a character class
    // plus one alternative clause: dropping a single member of the class changes
    // only that case, and a single combined assertion could not tell which.
    const leads = [
      { value: '=1+1', why: 'equals' },
      { value: '+1+1', why: 'plus' },
      { value: '@SUM(1)', why: 'at' },
      { value: '\t=value', why: 'tab' },
      { value: '\rvalue', why: 'carriage return' },
    ];

    for (const { value, why } of leads) {
      const element = rect({ link: value });

      // Raw bytes, because the placement of the apostrophe relative to the quotes
      // is the claim: it must precede the opening quote, not sit inside it, or the
      // reader would recover literal text `'=1+1` instead of a forced-text `=1+1`.
      expect(rawCell(element, 'link'), why).toBe(`"'${value}"`);
      // And what the reader gets back, so the value is unchanged apart from the
      // one added character.
      expect(cell(element, 'link'), why).toBe(`'${value}`);
    }
  });

  it('neutralises a leading hyphen only before a digit or an open paren', () => {
    // The trade-off the file argues for: `- item` is how people write a bullet and
    // Excel does not read it as a formula, so prefixing it would corrupt ordinary
    // text. `-1` and `-(1+2)` are the two forms that can be read as one.
    const bullet = rect({ link: '- item' });
    const numeric = rect({ link: '-1' });
    const expression = rect({ link: '-(1+2)' });

    // The bullet is written bare: no quotes and no apostrophe, i.e. exactly the
    // ordinary text the narrow rule exists to leave alone.
    expect(rawCell(bullet, 'link')).toBe('- item');
    expect(cell(bullet, 'link')).toBe('- item');
    // The two form-like spellings are always quoted, apostrophe outside.
    expect(rawCell(numeric, 'link')).toBe(`"'-1"`);
    expect(cell(numeric, 'link')).toBe("'-1");
    expect(rawCell(expression, 'link')).toBe(`"'-(1+2)"`);
    expect(cell(expression, 'link')).toBe("'-(1+2)");
  });

  it('leaves a negative number alone, so a left-positioned element keeps its x', () => {
    // The other half of the same trade-off: neutralisation tests `typeof value ===
    // 'string'`, not whether the rendered cell starts with a `-`. A coordinate of
    // -50 is a number, and every element left of the origin has one.
    const element = rect({ x: -50, y: -12.5 });

    expect(cell(element, 'x')).toBe('-50');
    expect(cell(element, 'y')).toBe('-12.5');
    // No apostrophe anywhere in the row. A rule keyed on the rendered text rather
    // than on `typeof value` would turn every left-of-origin element into `'-50`.
    expect(buildCsv([element])).not.toContain("'-");
    // The string spelling of the same digits is a different case, and is caught:
    // it is quoted with the apostrophe outside, where the number was left bare.
    expect(rawCell(rect({ link: '-50' }), 'link')).toBe(`"'-50"`);
    expect(cell(rect({ link: '-50' }), 'link')).toBe("'-50");
  });

  it('quotes a neutralised formula with the apostrophe outside, so =SUM("a") stays a formula', () => {
    // Needs all three behaviours at once: neutralisation, quote-doubling for the
    // embedded quotes, and the outer quotes. With the apostrophe inside them, the
    // cell would read back as the string `'=SUM("a")` — the very text the
    // neutralisation exists to prevent — instead of a forced-text `=SUM("a")`.
    const element = rect({ link: '=SUM("a")' });

    expect(rawCell(element, 'link')).toBe('"\'=SUM(""a"")"');
    expect(cell(element, 'link')).toBe('\'=SUM("a")');
  });

  it('neutralises in every string column, not just one', () => {
    for (const column of STRING_COLUMNS) {
      const element = rect({ [column]: '=cmd' });

      expect(cell(element, column)).toBe("'=cmd");
    }
  });

  it('passes the raw value through when neutraliseFormulas is false', () => {
    // The opt-out. Asserted on both shapes: a formula, which must arrive
    // untouched but still correctly quoted, and a plain hyphenated string, which
    // must not gain an apostrophe it never had.
    const formula = rect({ link: '=SUM("a")' });
    const bullet = rect({ link: '- item' });

    expect(rawCell(formula, 'link', { neutraliseFormulas: false })).toBe('"=SUM(""a"")"');
    expect(cell(formula, 'link', { neutraliseFormulas: false })).toBe('=SUM("a")');
    expect(cell(bullet, 'link', { neutraliseFormulas: false })).toBe('- item');
    expect(buildCsv([formula], { neutraliseFormulas: false })).not.toContain("'");
    // Escaping does not depend on the option: only formula handling does.
    expect(buildCsv([textElement('a,"b"')], { neutraliseFormulas: false })).toContain('""');
  });
});

/* ------------------------------------------------------------------ *
 * The blob.
 * ------------------------------------------------------------------ */

describe('exportToCsv', () => {
  it('prepends a UTF-8 BOM, so Excel reads the file as UTF-8', async () => {
    // Non-ASCII element text is exactly the content a user is most likely to have
    // typed in their own script, and Excel reads a BOM-less UTF-8 file as the
    // system codepage.
    const blob = exportToCsv([textElement('café — naïve', { id: 't1' })]);
    const text = await readBlob(blob);

    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.slice(1)).toContain('café');
  });

  it('declares text/csv with the utf-8 charset', () => {
    expect(exportToCsv([]).type).toBe('text/csv;charset=utf-8');
  });

  it('is buildCsv behind the BOM, and nothing else', async () => {
    const elements = [rect({ id: 'a' }), textElement('x,y', { id: 'b' })];
    const text = await readBlob(exportToCsv(elements));

    expect(text).toBe(`${BOM}${buildCsv(elements)}`);
  });

  it('keeps the BOM out of buildCsv, whose output is directly assertable', async () => {
    // The two halves are separable on purpose: a BOM inside the pure builder would
    // put an invisible character at the head of every string assertion above, and
    // every one of them would have to strip it first.
    expect(buildCsv([]).startsWith('id,')).toBe(true);
    expect(buildCsv([])).not.toContain(BOM);
    // And the blob does carry it — the asymmetry is the assertion.
    expect((await readBlob(exportToCsv([]))).charCodeAt(0)).toBe(0xfeff);
  });
});

/* ------------------------------------------------------------------ *
 * Dispatch wiring.
 * ------------------------------------------------------------------ */

describe('exportCanvas — the csv route', () => {
  it('returns the CSV blob', async () => {
    // The scene carries a comma-bearing text element, so "the blob is a CSV" is
    // checked on bytes that need escaping rather than on a trivially plain scene.
    const elements = [rect({ id: 'a' }), textElement('x,"y"\nz', { id: 'b' })];
    const blob = await Promise.resolve(exportCanvas('csv', elements));
    const text = await readBlob(blob);

    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(text).toBe(`${BOM}${buildCsv(elements)}`);

    // Read back through the same parser a consumer would use, with the BOM removed
    // the way a reader removes it: three records of full width. A CSV-shaped blob
    // that had lost the escaping would still have the right MIME type.
    const parsed = records(text.replace(BOM, ''));

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual(HEADER);
    expect(parsed[2]).toHaveLength(HEADER.length);
    expect(JSON.parse(parsed[2]![EXTRA_AT]!)['text']).toBe('x,"y"\nz');
  });

  it('returns the blob synchronously, like svg and dripl and unlike png', () => {
    const raw = exportCanvas('csv', [rect({ id: 'a' })]) as Blob;

    expect(raw).toBeInstanceOf(Blob);
    expect((raw as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('still refuses pdf, which the union does not include', () => {
    // `'pdf'` is absent from the parameter type on purpose: `ExportModal` builds a
    // PDF from a PNG and returns before reaching here. The dispatch ends in an
    // explicit throw rather than falling through to JSON, because with a residual
    // fallthrough a moved early return would download JSON under the name `*.pdf`
    // and report it as a success. The union is erased at runtime, so the guard has
    // to stand on its own.
    const unchecked = 'pdf' as Parameters<typeof exportCanvas>[0];

    expect(() => exportCanvas(unchecked, [rect({ id: 'a' })])).toThrow(
      /unsupported export format: "pdf"/i
    );
  });
});
