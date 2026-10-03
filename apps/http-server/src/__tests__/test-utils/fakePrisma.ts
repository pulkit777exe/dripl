/**
 * In-memory stand-in for the slice of Prisma Client that http-server's
 * services actually call.
 *
 * WHY THIS EXISTS INSTEAD OF `vi.fn()` STUBS
 *
 * An authorisation test is only worth anything if the database refuses to
 * return a row the caller is not entitled to. `vi.fn()` stubs cannot express
 * that: they answer whatever the test hands them, so a suite built on them
 * asserts "the handler forwarded `req.userId` to the service" and nothing more
 * — and that assertion survives a service that stops passing `userId` at all,
 * because the stub still answers 200. This fake evaluates the `where` clause
 * the service built, so if ownership is dropped from a query the row comes
 * back and the suite goes red.
 *
 * The narrower claim is asserted separately, in the tests: that the `where`
 * clause carried the caller's id at all. Both together are what "user A cannot
 * read user B's file" actually means.
 *
 * SCOPE — deliberately small, and loud about it. Only the operators and shapes
 * the services under test use are implemented; anything else throws rather than
 * quietly answering `[]`, so an unimplemented filter can never masquerade as a
 * pass.
 */

export type Row = Record<string, unknown>;
export type Where = Record<string, unknown>;

type OrderBy = Record<string, 'asc' | 'desc'>;
type SelectMap = Record<string, unknown>;

export interface FindArgs {
  where?: Where;
  orderBy?: OrderBy | OrderBy[];
  skip?: number;
  take?: number;
  select?: SelectMap;
  include?: SelectMap;
}

export interface CountArgs {
  where?: Where;
}

export interface CreateArgs {
  data: Row;
  select?: SelectMap;
}

export interface UpdateArgs {
  where: Where;
  data: Row;
  select?: SelectMap;
}

export interface UpdateManyArgs {
  where?: Where;
  data: Row;
}

export interface UpdateManyAndReturnArgs extends UpdateManyArgs {
  select?: SelectMap;
}

export interface DeleteArgs {
  where: Where;
}

export interface DeleteManyArgs {
  where?: Where;
}

export interface FakeModel {
  findFirst(args?: FindArgs): Promise<Row | null>;
  findUnique(args?: FindArgs): Promise<Row | null>;
  findMany(args?: FindArgs): Promise<Row[]>;
  count(args?: CountArgs): Promise<number>;
  create(args: CreateArgs): Promise<Row>;
  update(args: UpdateArgs): Promise<Row>;
  updateMany(args: UpdateManyArgs): Promise<{ count: number }>;
  updateManyAndReturn(args: UpdateManyAndReturnArgs): Promise<Row[]>;
  delete(args: DeleteArgs): Promise<Row>;
  deleteMany(args?: DeleteManyArgs): Promise<{ count: number }>;
}

/**
 * The models this fake provides, named explicitly rather than as
 * `Record<string, FakeModel>`.
 *
 * An open-ended record would also require `$transaction` and `$queryRaw` to be
 * `FakeModel`s, which they are not — the intersection could never be
 * satisfied, so `db` was not assignable to its own interface. Naming the keys
 * says what the fake actually models, which is the thing a reader wants.
 */
export type FakeModelName =
  | 'file'
  | 'folder'
  | 'sharedFile'
  | 'user'
  | 'emailVerificationToken'
  | 'passwordResetToken'
  | 'canvasRoom'
  | 'canvasRoomMember'
  | 'shareLink';

export interface FakeDb {
  db: Record<FakeModelName, FakeModel> & {
    $transaction: (ops: Array<Promise<unknown>>) => Promise<unknown[]>;
    $queryRaw: () => Promise<Array<Record<string, unknown>>>;
  };
  reset(): void;
  rows(table: string): Row[];
  seed(table: string, row: Row): Row;
}

const EPOCH = '2026-01-01T00:00:00.000Z';

function unsupported(detail: string): never {
  throw new Error(`fakePrisma: unsupported query shape — ${detail}`);
}

/** Prisma stores NULL; an omitted field on a JS row means the same thing. */
function normalise(value: unknown): unknown {
  return value === undefined ? null : value;
}

function equals(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return normalise(left) === normalise(right);
}

function compare(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return unsupported(`cannot order-compare ${typeof left} against ${typeof right}`);
}

function contains(actual: unknown, needle: unknown, caseInsensitive: boolean): boolean {
  const raw = normalise(actual);
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value);
  const haystack = raw === null ? '' : fold(String(raw));
  return haystack.includes(fold(String(needle)));
}

function matchesOperators(actual: unknown, operators: Record<string, unknown>): boolean {
  // `mode` qualifies `contains`; Prisma folds it into the operator rather than
  // treating it as a filter of its own.
  const caseInsensitive = operators.mode === 'insensitive';
  const clauses = Object.entries(operators).filter(([operator]) => operator !== 'mode');
  return clauses.every(([operator, operand]) => {
    switch (operator) {
      case 'in':
        if (!Array.isArray(operand)) unsupported(`'in' needs an array, got ${typeof operand}`);
        return operand.some(candidate => equals(actual, candidate));
      case 'notIn':
        if (!Array.isArray(operand)) unsupported(`'notIn' needs an array, got ${typeof operand}`);
        return !operand.some(candidate => equals(actual, candidate));
      case 'lt':
        return compare(actual, operand) < 0;
      case 'lte':
        return compare(actual, operand) <= 0;
      case 'gt':
        return compare(actual, operand) > 0;
      case 'gte':
        return compare(actual, operand) >= 0;
      case 'contains':
        return contains(actual, operand, caseInsensitive);
      default:
        return unsupported(`operator '${operator}' is not implemented`);
    }
  });
}

/** The filter operators this fake understands. Anything else is a nested shape. */
const OPERATORS = new Set(['in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'mode']);

/**
 * Prisma's compound-unique `where` — `{ roomId_userId: { roomId, userId } }` — is
 * an object-valued field whose keys are themselves columns. It is told apart
 * from an operator object by the underscore in the field name, which no filter
 * operator has.
 */
function isCompoundWhere(field: string, condition: unknown): boolean {
  return (
    field.includes('_') &&
    condition !== null &&
    typeof condition === 'object' &&
    !Array.isArray(condition)
  );
}

/**
 * Prisma relation field name -> table name, from `schema.prisma`.
 *
 * A relation FIELD NAME is not the model name: `CanvasRoomMember.room` points
 * at `CanvasRoom`, and `CanvasRoom.members` at `CanvasRoomMember`. Deriving
 * the table from the field name made the fake answer `null` to a perfectly
 * valid `include`, which surfaced as a baffling assertion failure in the
 * caller rather than an honest "this fake does not model that".
 */
const RELATION_TABLE: Record<string, string> = {
  room: 'canvasRoom',
  canvasRooms: 'canvasRoom',
  members: 'canvasRoomMember',
  owner: 'user',
  user: 'user',
  team: 'team',
  folder: 'folder',
  file: 'file',
};

function matchesCondition(actual: unknown, condition: unknown): boolean {
  // Prisma drops `undefined` entries from a `where` rather than matching NULL.
  if (condition === undefined) return true;
  if (condition === null) return normalise(actual) === null;
  if (condition instanceof Date || typeof condition !== 'object') return equals(actual, condition);
  if (Array.isArray(condition)) unsupported('array shorthand filters are not implemented');
  const entries = Object.entries(condition as Record<string, unknown>);
  if (entries.length > 0 && !entries.some(([key]) => OPERATORS.has(key))) {
    return unsupported(`field filter with unknown keys: ${entries.map(([key]) => key).join(', ')}`);
  }
  return matchesOperators(actual, condition as Record<string, unknown>);
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'AND') {
      const branches = condition as Where[];
      return branches.every(branch => matches(row, branch));
    }
    if (field === 'OR') {
      const branches = condition as Where[];
      return branches.some(branch => matches(row, branch));
    }
    if (isCompoundWhere(field, condition)) {
      return matches(row, condition as Where);
    }
    return matchesCondition(row[field], condition);
  });
}

function sortRows(rows: Row[], orderBy: OrderBy | OrderBy[] | undefined): Row[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const [column, direction] of Object.entries(clause)) {
        const delta = compare(left[column], right[column]);
        if (delta !== 0) return direction === 'desc' ? -delta : delta;
      }
    }
    return 0;
  });
}

function stripUndefined(data: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function createFakeDb(): FakeDb {
  const tables: Record<string, Row[]> = {};
  const counters: Record<string, number> = {};
  const now = (): Date => new Date(EPOCH);

  const rows = (table: string): Row[] => {
    const existing = tables[table];
    if (existing) return existing;
    const created: Row[] = [];
    tables[table] = created;
    return created;
  };

  const nextId = (table: string): string => {
    counters[table] = (counters[table] ?? 0) + 1;
    return `${table}-${counters[table]}`;
  };

  function resolveRelation(sourceTable: string, row: Row, field: string, spec: SelectMap): unknown {
    if (field === '_count') {
      const wanted = Object.keys((spec.select as SelectMap | undefined) ?? {});
      const counts: Record<string, number> = {};
      for (const relation of wanted) {
        if (relation !== 'files') unsupported(`_count.${relation} on ${sourceTable}`);
        counts[relation] = rows('file').filter(file => file.folderId === row.id).length;
      }
      return counts;
    }
    // A Prisma relation FIELD NAME is not the model name: `CanvasRoomMember.room`
    // points at `CanvasRoom`, not at a table called `room`. Guessing made the
    // fake return `null` for a perfectly valid include, which surfaced as a
    // baffling assertion failure in the caller instead of an honest "I do not
    // model this".
    const relatedTable = RELATION_TABLE[field];
    if (!relatedTable) {
      unsupported(`relation '${field}' on ${sourceTable} is not modelled by this fake`);
    }
    const foreignValue = row[`${field}Id`];
    if (foreignValue === null || foreignValue === undefined) return null;
    const related = rows(relatedTable).find(candidate => candidate.id === foreignValue);
    if (!related) return null;
    return project(relatedTable, related, spec.select as SelectMap | undefined);
  }

  function project(table: string, row: Row, select?: SelectMap, include?: SelectMap): Row {
    const readField = (field: string, spec: unknown, into: Row): void => {
      if (spec === false || spec === undefined) return;
      if (spec === true || typeof spec !== 'object') {
        into[field] = row[field];
        return;
      }
      into[field] = resolveRelation(table, row, field, spec as SelectMap);
    };

    if (select) {
      const picked: Row = {};
      for (const [field, spec] of Object.entries(select)) readField(field, spec, picked);
      return picked;
    }

    const projected: Row = { ...row };
    if (include) {
      for (const [field, spec] of Object.entries(include)) readField(field, spec, projected);
    }
    return projected;
  }

  function buildModel(table: string): FakeModel {
    return {
      async findFirst(args: FindArgs = {}) {
        const found = rows(table).find(row => matches(row, args.where));
        return found ? project(table, found, args.select, args.include) : null;
      },

      async findUnique(args: FindArgs = {}) {
        const found = rows(table).filter(row => matches(row, args.where));
        if (found.length > 1) unsupported(`findUnique matched ${found.length} rows in ${table}`);
        const only = found[0];
        return only ? project(table, only, args.select, args.include) : null;
      },

      async findMany(args: FindArgs = {}) {
        const matched = sortRows(
          rows(table).filter(row => matches(row, args.where)),
          args.orderBy
        );
        const start = args.skip ?? 0;
        const page =
          args.take === undefined ? matched.slice(start) : matched.slice(start, start + args.take);
        return page.map(row => project(table, row, args.select, args.include));
      },

      async count(args: CountArgs = {}) {
        return rows(table).filter(row => matches(row, args.where)).length;
      },

      async create(args: CreateArgs) {
        const created: Row = {
          id: nextId(table),
          createdAt: now(),
          updatedAt: now(),
          ...args.data,
        };
        rows(table).push(created);
        return project(table, created, args.select);
      },

      async update(args: UpdateArgs) {
        const target = rows(table).find(row => matches(row, args.where));
        if (!target) throw new Error(`fakePrisma: update matched no row in ${table} (P2025 shape)`);
        Object.assign(target, stripUndefined(args.data), { updatedAt: now() });
        return project(table, target, args.select);
      },

      async updateMany(args: UpdateManyArgs) {
        const patch = stripUndefined(args.data);
        let count = 0;
        for (const row of rows(table)) {
          if (!matches(row, args.where)) continue;
          Object.assign(row, patch);
          count += 1;
        }
        return { count };
      },

      async updateManyAndReturn(args: UpdateManyAndReturnArgs) {
        const patch = stripUndefined(args.data);
        const updated: Row[] = [];
        for (const row of rows(table)) {
          if (!matches(row, args.where)) continue;
          Object.assign(row, patch);
          updated.push(project(table, row, args.select));
        }
        return updated;
      },

      async delete(args: DeleteArgs) {
        const tableRows = rows(table);
        const index = tableRows.findIndex(row => matches(row, args.where));
        if (index === -1) {
          throw new Error(`fakePrisma: delete matched no row in ${table} (P2025 shape)`);
        }
        const removed = tableRows.splice(index, 1);
        return removed[0] as Row;
      },

      async deleteMany(args: DeleteManyArgs = {}) {
        const tableRows = rows(table);
        const kept = tableRows.filter(row => !matches(row, args.where));
        const count = tableRows.length - kept.length;
        tables[table] = kept;
        return { count };
      },
    };
  }

  const db = {
    file: buildModel('file'),
    folder: buildModel('folder'),
    sharedFile: buildModel('sharedFile'),
    user: buildModel('user'),
    emailVerificationToken: buildModel('emailVerificationToken'),
    passwordResetToken: buildModel('passwordResetToken'),
    canvasRoom: buildModel('canvasRoom'),
    canvasRoomMember: buildModel('canvasRoomMember'),
    shareLink: buildModel('shareLink'),
    $transaction: async (ops: Array<Promise<unknown>>): Promise<unknown[]> => Promise.all(ops),
    $queryRaw: async (): Promise<Array<Record<string, unknown>>> => [{ ok: 1 }],
  };

  const seed = (table: string, row: Row): Row => {
    const tableRows = rows(table);
    const index = tableRows.findIndex(candidate => candidate.id === row.id);
    const merged = { createdAt: now(), updatedAt: now(), ...row };
    if (index >= 0) tableRows[index] = { ...tableRows[index], ...merged };
    else tableRows.push(merged);
    return merged;
  };

  const reset = (): void => {
    for (const key of Object.keys(tables)) delete tables[key];
    for (const key of Object.keys(counters)) delete counters[key];
  };

  return { db, reset, rows, seed };
}

let singleton: FakeDb | null = null;

/**
 * Process-wide instance. `vi.mock('@dripl/db')` and the test files import this
 * module, so both must reach the same registry — a second instance would seed
 * rows the code under test cannot see, and every assertion would be vacuous.
 */
export function fakeDb(): FakeDb {
  singleton ??= createFakeDb();
  return singleton;
}

export function resetFakeDb(): void {
  fakeDb().reset();
}
