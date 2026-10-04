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
  /**
   * The generation currently stored for `userId`, or `null` for an unknown one.
   *
   * The counterpart to `loadStoredTokenVersion` in `@dripl/db`: a test that
   * revokes and then re-presents the token needs to read the generation back off
   * the row rather than off a return value the fake computed for itself.
   */
  tokenVersionOf(userId: string): number | null;
}

const EPOCH = '2026-01-01T00:00:00.000Z';

/**
 * `@default` values from `schema.prisma`, for columns http-server's services omit
 * on insert. Verified against a real `postgres:16` rather than read off the schema:
 * that is how the `googleAuth` gap described at `create` was found.
 */
const COLUMN_DEFAULTS: Record<string, Row> = {
  user: { emailVerified: false, tokenVersion: 0, password: null },
  canvasRoomMember: { role: 'EDITOR' },
  shareLink: { permission: 'VIEW' },
  file: { content: '[]', sharePermission: 'view', shareToken: null },
  canvasRoom: { content: '[]', isPublic: false },
};

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

/**
 * The one-to-many relations, from `schema.prisma`: relation field name -> the
 * table and the foreign key that points back at the including row.
 *
 * `RELATION_TABLE` above answers the *many-to-one* direction, where the including
 * row carries the foreign key. These are the reverse, and without them the fake
 * resolved `CanvasRoom.members` through the many-to-one path -- reading
 * `row.membersId`, which no `CanvasRoom` row has, and answering `null`. That made
 * `RoomService.getRoom` throw on `room.members.some(...)`, so every route-level
 * test of `GET /api/rooms/:slug` saw a 500 and no test could reach the
 * authorisation branch it was written for.
 *
 * The failure was quiet in the worst way: a 500 is a plausible-looking assertion
 * failure, and a suite that reads as "the route errors" would have been filed as
 * an app bug rather than a gap in the harness.
 */
const HAS_MANY_RELATIONS: Record<string, { table: string; foreignKey: string }> = {
  members: { table: 'canvasRoomMember', foreignKey: 'roomId' },
  shareLinks: { table: 'shareLink', foreignKey: 'roomId' },
};

function manyTableOf(field: string): string {
  const relation = HAS_MANY_RELATIONS[field];
  if (!relation) unsupported(`'${field}' is not a has-many relation`);
  return relation.table;
}

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

/**
 * How a `where` clause reaches the storage this fake holds rows in.
 *
 * `matches` is module-level and needs one thing the row itself cannot answer: the
 * rows on the far side of a one-to-many relation. `RoomService.listRooms` filters
 * with `{ members: { some: { userId } } }` -- that clause *is* the authorisation
 * (it is what admits a collaborator's room), so a fake that cannot evaluate it
 * cannot test the authorisation at all. Without this context the fake threw
 * `field filter with unknown keys: some`, every `GET /api/rooms` answered 500, and
 * the suite read as though the route were broken.
 */
export interface MatchContext {
  rowsOf(field: string, row: Row): Row[] | null;
}

/** The relation *quantifiers* Prisma allows inside a field filter on a list relation. */
const RELATION_QUANTIFIERS = new Set(['some', 'none', 'every']);

function matchesRelationFilter(
  list: Row[],
  quantifiers: Record<string, unknown>,
  ctx: MatchContext
): boolean {
  return Object.entries(quantifiers).every(([quantifier, filter]) => {
    const where = (filter ?? {}) as Where;
    switch (quantifier) {
      case 'some':
        return list.some(related => matches(related, where, ctx));
      case 'none':
        return !list.some(related => matches(related, where, ctx));
      case 'every':
        return list.every(related => matches(related, where, ctx));
      default:
        return unsupported(`relation quantifier '${quantifier}' is not implemented`);
    }
  });
}

function matches(row: Row, where: Where | undefined, ctx: MatchContext): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'AND') {
      const branches = condition as Where[];
      return branches.every(branch => matches(row, branch, ctx));
    }
    if (field === 'OR') {
      const branches = condition as Where[];
      return branches.some(branch => matches(row, branch, ctx));
    }
    if (isCompoundWhere(field, condition)) {
      return matches(row, condition as Where, ctx);
    }
    const related =
      condition !== null && typeof condition === 'object' && !Array.isArray(condition)
        ? ctx.rowsOf(field, row)
        : null;
    if (related) {
      const quantifiers = condition as Record<string, unknown>;
      const keys = Object.keys(quantifiers);
      if (keys.length > 0 && !keys.some(key => RELATION_QUANTIFIERS.has(key))) {
        return unsupported(
          `filter on has-many relation '${field}' uses unknown keys: ${keys.join(', ')}`
        );
      }
      return matchesRelationFilter(related, quantifiers, ctx);
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

/**
 * Resolve Prisma's atomic update operators against the row being updated.
 *
 * `{ increment: n }` is rendered by Prisma as `SET "col" = "col" + n`, so the fake
 * has to do the same -- otherwise a revocation would leave the stored generation
 * where it was and every test built on one would pass for the wrong reason.
 *
 * One operator per field, and only the one that is present. Prisma rejects a spec
 * carrying more than one, so an unrecognised key is a loud error rather than a
 * silent no-op: a typo like `{ incremnet: 1 }` must not read as "nothing to do".
 */
const UPDATE_OPERATORS = {
  increment: (current: number, operand: number): number => current + operand,
  decrement: (current: number, operand: number): number => current - operand,
  multiply: (current: number, operand: number): number => current * operand,
  divide: (current: number, operand: number): number =>
    operand === 0 ? current : current / operand,
} as const;

type UpdateOperator = keyof typeof UPDATE_OPERATORS;

function isUpdateOperatorSpec(value: unknown): value is Record<UpdateOperator, number> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Row).length > 0 &&
    Object.keys(value as Row).every(key => key in UPDATE_OPERATORS)
  );
}

function applyOperators(data: Row, target: Row): Row {
  const resolved: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (!isUpdateOperatorSpec(value)) {
      resolved[key] = value;
      continue;
    }
    const [operator, operand] = Object.entries(value)[0] as [UpdateOperator, number];
    const current = normalise(target[key]) as number | null;
    if (typeof current !== 'number') {
      throw new Error(
        `fakePrisma: cannot apply { ${operator}: ${operand} } to ${key}, which holds ${typeof current}`
      );
    }
    resolved[key] = UPDATE_OPERATORS[operator](current, operand);
  }
  return resolved;
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

  const relatedRowsFor = (field: string, row: Row): Row[] | null => {
    const many = HAS_MANY_RELATIONS[field];
    if (!many) return null;
    return rows(many.table).filter(candidate => candidate[many.foreignKey] === row.id);
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
    // One-to-many first: `RELATION_TABLE` also carries `members`, and resolving it
    // through the many-to-one path below would read a column no including row has.
    const related = relatedRowsFor(field, row);
    if (related) {
      const selector = (spec as SelectMap).select;
      if (selector === undefined || typeof selector !== 'object') {
        unsupported(`has-many relation '${field}' needs an explicit select`);
      }
      return related.map(candidate =>
        project(manyTableOf(field), candidate, selector as SelectMap)
      );
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
    const single = rows(relatedTable).find(candidate => candidate.id === foreignValue);
    if (!single) return null;
    return project(relatedTable, single, spec.select as SelectMap | undefined);
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

  // The one context every `where` evaluation in this store shares. Reads the
  // tables live, so rows seeded or created after the module loaded are visible.
  const ctx: MatchContext = { rowsOf: relatedRowsFor };

  function buildModel(table: string): FakeModel {
    return {
      async findFirst(args: FindArgs = {}) {
        const found = rows(table).find(row => matches(row, args.where, ctx));
        return found ? project(table, found, args.select, args.include) : null;
      },

      async findUnique(args: FindArgs = {}) {
        const found = rows(table).filter(row => matches(row, args.where, ctx));
        if (found.length > 1) unsupported(`findUnique matched ${found.length} rows in ${table}`);
        const only = found[0];
        return only ? project(table, only, args.select, args.include) : null;
      },

      async findMany(args: FindArgs = {}) {
        const matched = sortRows(
          rows(table).filter(row => matches(row, args.where, ctx)),
          args.orderBy
        );
        const start = args.skip ?? 0;
        const page =
          args.take === undefined ? matched.slice(start) : matched.slice(start, start + args.take);
        return page.map(row => project(table, row, args.select, args.include));
      },

      async count(args: CountArgs = {}) {
        return rows(table).filter(row => matches(row, args.where, ctx)).length;
      },

      async create(args: CreateArgs) {
        const created: Row = {
          id: nextId(table),
          createdAt: now(),
          updatedAt: now(),
          // Column defaults from `schema.prisma`, applied before the caller's data
          // so an explicit value still wins.
          //
          // WITHOUT THESE the fake returns a row with `emailVerified` and
          // `tokenVersion` *absent*, where PostgreSQL returns `false` and `0`. That
          // is not cosmetic: `googleAuth` creates an account without naming either
          // column and hands the result straight to `POST /api/auth/google`, which
          // signs the session token from `tokenVersion`. Against the fake the field
          // reads `undefined`, against the real database it reads `0` — so a suite
          // built on the fake cannot tell the two apart, and a defect in either is
          // invisible until it reaches a deployed environment.
          //
          // Only the columns http-server's services actually omit are listed. A
          // column the services always set is not a divergence, and guessing at the
          // rest would be a second schema to keep in step.
          ...(COLUMN_DEFAULTS[table] ?? {}),
          ...args.data,
        };
        rows(table).push(created);
        return project(table, created, args.select);
      },

      async update(args: UpdateArgs) {
        const target = rows(table).find(row => matches(row, args.where, ctx));
        if (!target) throw new Error(`fakePrisma: update matched no row in ${table} (P2025 shape)`);
        Object.assign(target, applyOperators(stripUndefined(args.data), target), {
          updatedAt: now(),
        });
        return project(table, target, args.select);
      },

      async updateMany(args: UpdateManyArgs) {
        const patch = stripUndefined(args.data);
        let count = 0;
        for (const row of rows(table)) {
          if (!matches(row, args.where, ctx)) continue;
          Object.assign(row, patch);
          count += 1;
        }
        return { count };
      },

      async updateManyAndReturn(args: UpdateManyAndReturnArgs) {
        const patch = stripUndefined(args.data);
        const updated: Row[] = [];
        for (const row of rows(table)) {
          if (!matches(row, args.where, ctx)) continue;
          Object.assign(row, patch);
          updated.push(project(table, row, args.select));
        }
        return updated;
      },

      async delete(args: DeleteArgs) {
        const tableRows = rows(table);
        const index = tableRows.findIndex(row => matches(row, args.where, ctx));
        if (index === -1) {
          throw new Error(`fakePrisma: delete matched no row in ${table} (P2025 shape)`);
        }
        const removed = tableRows.splice(index, 1);
        return removed[0] as Row;
      },

      async deleteMany(args: DeleteManyArgs = {}) {
        const tableRows = rows(table);
        const kept = tableRows.filter(row => !matches(row, args.where, ctx));
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

  const tokenVersionOf = (userId: string): number | null => {
    const row = rows('user').find(candidate => candidate.id === userId);
    if (!row) return null;
    return typeof row.tokenVersion === 'number' ? row.tokenVersion : null;
  };

  return { db, reset, rows, seed, tokenVersionOf };
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
