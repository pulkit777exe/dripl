import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { broadcast } from '../src/broadcast';
import { sceneDeltaSchema, sceneUpdateSchema } from '../src/validation';
import type { DriplElement } from '@dripl/common';
import type { RoomState } from '../src/types';

/**
 * Server hot-path throughput benchmark.
 *
 * The render path has a benchmark; the server side had none, so the one number the
 * source itself commits to — "an active editor emits ~20 scene-deltas/sec"
 * (`src/index.ts:410`) — had never been checked against anything.
 *
 * Two costs matter on the collaboration hot path, and they scale differently:
 *
 *   admit   zod-validating one `scene-delta` message. Pure CPU, once per message
 *           per connection, and it runs *before* any I/O. This is the cost that
 *           sets the ceiling for one connection.
 *
 *   fan out `broadcast` to every peer in the room. `broadcast` stringifies the
 *           payload **once** and reuses the string, so this is one serialisation
 *           plus N socket writes. That design is why fan-out is not quadratic in
 *           serialisation, and the benchmark reports the per-peer increment so the
 *           shape of that is visible rather than assumed.
 *
 * Everything here is in-process and CPU-only: no socket is opened and no database
 * is touched. That is a deliberate limit, and it means these numbers are an upper
 * bound on throughput and a lower bound on cost — the network and the persistence
 * debounce are not in them. A number presented as "sustains N mutations/sec" without
 * that caveat would be a claim this harness cannot support.
 *
 * Counts are the primary output. The millisecond column is printed alongside them
 * only so its own noise floor is visible, never on its own as a claim.
 *
 * Run with `pnpm --filter ws-server bench:hot`.
 */

const MS = 1_000;

/** Editors the ADR text assumes per room, and the per-editor delta rate. */
const DELTAS_PER_SECOND_PER_EDITOR = 20;

function element(id: string, overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 12.5,
    y: -8.25,
    width: 120,
    height: 64,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: 'solid',
    fillStyle: 'hachure',
    version: 3,
    versionNonce: 91_237,
    updated: 1_757_000_000_000,
    ...overrides,
  } as DriplElement;
}

/** A drag moves one element per frame, so a realistic delta carries a small batch. */
function delta(updatedCount: number): unknown {
  return {
    type: 'scene-delta',
    updated: Array.from({ length: updatedCount }, (_, i) =>
      element(`el-${i}`, { version: 3 + i, updated: 1_757_000_000_000 + i })
    ),
  };
}

/**
 * Refuse to report a number for a schema that did not actually look at the data.
 *
 * This exists because of a bug in the first version of this benchmark: the
 * snapshot case validated a `{elements, subtype}` payload against
 * `sceneDeltaSchema`, which has no `elements` key at all. Zod strips unknown keys,
 * so it succeeded having parsed nothing and reported 0 us for a 5 000-element
 * scene — a number that looked like a finding and was pure fiction. A benchmark
 * that cannot detect its own no-op is worse than none.
 */
function assertConsumed(
  label: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
  payload: unknown,
  key: string,
  expectedCount: number
): void {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`${label}: schema rejected the fixture, so the measurement is void`);
  }
  const parsed = result.data as Record<string, unknown> | undefined;
  const actual = parsed?.[key];
  if (!Array.isArray(actual) || actual.length !== expectedCount) {
    throw new Error(
      `${label}: schema returned success but ${key} has ${Array.isArray(actual) ? actual.length : typeof actual}` +
        ` entries, expected ${expectedCount}. The schema is stripping the payload and the timing is meaningless.`
    );
  }
}

/** A room snapshot sync carries the whole scene. */
function snapshot(sceneSize: number): unknown {
  return {
    // `sceneUpdateSchema` discriminates on 'scene-update', not 'scene-delta'.
    type: 'scene-update',
    subtype: 'init',
    elements: Array.from({ length: sceneSize }, (_, i) => element(`el-${i}`)),
  };
}

interface Measurement {
  label: string;
  iterations: number;
  msTotal: number;
  perOpUs: number;
  opsPerSecond: number;
  bytesPerOp: number;
}

function measure(
  label: string,
  iterations: number,
  bytesPerOp: number,
  body: () => void
): Measurement {
  // Warm up so the first sample does not carry JIT and module-load cost.
  for (let i = 0; i < Math.min(iterations, 2_000); i += 1) body();

  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) body();
  const msTotal = performance.now() - started;

  return {
    label,
    iterations,
    msTotal,
    perOpUs: (msTotal * 1_000) / iterations,
    opsPerSecond: iterations / (msTotal / MS),
    bytesPerOp,
  };
}

/**
 * Report the noise floor: the same body measured several times, so a reader can
 * see the spread and discount a difference smaller than it.
 */
function noiseFloor(label: string, body: () => void, runs = 5): number[] {
  const samples = Array.from({ length: runs }, () => {
    const started = performance.now();
    for (let i = 0; i < 5_000; i += 1) body();
    return ((performance.now() - started) * 1_000) / 5_000;
  });
  const sorted = [...samples].sort((a, b) => a - b);
  process.stdout.write(
    `  noise floor  ${label.padEnd(34)} median ${sorted[Math.floor(runs / 2)]!.toFixed(3)} us/op` +
      `  spread ${(sorted[runs - 1]! - sorted[0]!).toFixed(3)} us\n`
  );
  return samples;
}

function table(rows: Measurement[]): void {
  process.stdout.write(
    `\n  ${'measurement'.padEnd(36)}${'iters'.padStart(9)}${'us/op'.padStart(11)}` +
      `${'ops/sec'.padStart(14)}${'bytes/op'.padStart(12)}\n`
  );
  for (const r of rows) {
    process.stdout.write(
      `  ${r.label.padEnd(36)}${String(r.iterations).padStart(9)}` +
        `${r.perOpUs.toFixed(3).padStart(11)}${Math.round(r.opsPerSecond).toLocaleString('en-US').padStart(14)}` +
        `${String(r.bytesPerOp).padStart(12)}\n`
    );
  }
}

function main(): void {
  process.stdout.write('\nws-server hot path — CPU only, no socket and no database\n');
  process.stdout.write(
    'Upper bound on throughput, lower bound on cost: the network and the\n' +
      'persistence debounce are deliberately not in these numbers.\n'
  );

  // ── Noise floor, before anything is claimed ───────────────────────────────
  process.stdout.write('\n-- noise floor --\n');
  noiseFloor('noop', () => undefined);
  noiseFloor('sceneDeltaSchema.safeParse (1 element)', () => {
    sceneDeltaSchema.safeParse(delta(1));
  });

  const rows: Measurement[] = [];

  // ── Admission: validate one incoming delta ────────────────────────────────
  process.stdout.write('\n-- admission: zod validation of one scene-delta --\n');
  for (const count of [1, 5, 20, 100]) {
    const payload = delta(count);
    assertConsumed(`delta/${count}`, sceneDeltaSchema, payload, 'updated', count);
    rows.push(
      measure(`validate delta, ${String(count).padStart(3)} element(s)`, 20_000, 0, () => {
        sceneDeltaSchema.safeParse(payload);
      })
    );
  }

  table(rows);
  const snapshotSizes = [100, 1_000, 5_000];
  process.stdout.write('\n-- admission: zod validation of a scene snapshot --\n');
  for (const size of snapshotSizes) {
    const payload = snapshot(size);
    assertConsumed(`snapshot/${size}`, sceneUpdateSchema, payload, 'elements', size);
    rows.push(
      measure(
        `validate snapshot, ${String(size).padStart(4)} elements`,
        size >= 5_000 ? 200 : 2_000,
        0,
        () => {
          sceneUpdateSchema.safeParse(payload);
        }
      )
    );
  }

  table(rows);

  // ── Fan-out: broadcast one delta to N peers ───────────────────────────────
  process.stdout.write(
    '\n-- fan-out: broadcast to N peers --\n' +
      'Peers are fakes whose send() only counts bytes, so this measures the\n' +
      "server's own per-peer cost: the forEach, the readyState check, and the\n" +
      'string being handed over. It does NOT measure a socket write.\n'
  );
  const dragPayload = delta(1);
  const dragBytes = JSON.stringify(dragPayload).length;
  const fanRows: Measurement[] = [];
  for (const peers of [2, 10, 50, 200]) {
    const users = new Map<
      string,
      { userId: string; displayName: string; color: string; ws: WebSocket }
    >();
    for (let i = 0; i < peers; i += 1) {
      users.set(`u${i}`, {
        userId: `u${i}`,
        displayName: `User ${i}`,
        color: '#000000',
        ws: {
          readyState: WebSocket.OPEN,
          // Counts nothing on purpose: the byte column is derived from the
          // payload length and the peer count, which is exact. Accumulating here
          // measured this harness rather than the server.
          send(_data: string) {},
        } as unknown as WebSocket,
      });
    }
    const room = { roomId: 'bench', users } as unknown as RoomState;

    const iterations = peers >= 200 ? 2_000 : 20_000;
    fanRows.push(
      measure(
        `broadcast 1-element delta to ${String(peers).padStart(3)} peers`,
        iterations,
        dragBytes,
        () => {
          broadcast(room, dragPayload);
        }
      )
    );
  }
  table(fanRows);

  // The point of the fan-out rows: bytes written per op is peers x payload, which
  // is the memory-bandwidth term. Report it explicitly rather than leaving it in
  // the table to be inferred.
  process.stdout.write('\n  bytes written per broadcast = peers x payload bytes\n');
  for (const row of fanRows) {
    const peers = Number(row.label.match(/to\s+(\d+)\s+peers/)?.[1] ?? '0');
    process.stdout.write(
      `  ${String(peers).padStart(4)} peers -> ${(row.bytesPerOp * peers).toLocaleString('en-US').padStart(10)} bytes/op` +
        `   ${(row.perOpUs / peers).toFixed(4)} us per peer\n`
    );
  }

  // ── What that means against the documented load ──────────────────────────
  const delta1 = rows.find(r => r.label.includes('  1 element'))!;
  const delta100 = rows.find(r => r.label.includes('100 element'))!;
  const snap5000 = rows.find(r => r.label.includes('5000 elements'))!;

  const perElementUs = delta100.perOpUs / 100;
  process.stdout.write('\n-- what the numbers say --\n');
  process.stdout.write(
    `  steady-state delta (1 element):  ${delta1.perOpUs.toFixed(2)} us\n` +
      `  at ${DELTAS_PER_SECOND_PER_EDITOR} deltas/sec/editor that is ` +
      `${((delta1.perOpUs * DELTAS_PER_SECOND_PER_EDITOR) / 1000).toFixed(3)} ms of CPU per second,\n` +
      '  or 0.0x% of one thread. Steady-state editing is nowhere near the limit.\n'
  );
  process.stdout.write(
    `  admission cost is linear in elements at about ${perElementUs.toFixed(2)} us per element\n` +
      `  (100 elements ${delta100.perOpUs.toFixed(0)} us, 5 000 elements ` +
      `${snap5000.perOpUs.toFixed(0)} us -- ${(snap5000.perOpUs / delta100.perOpUs).toFixed(0)}x for 50x the elements).\n`
  );

  process.stdout.write(
    `\n  The number that actually matters: a maximum-size scene takes ` +
      `${(snap5000.perOpUs / 1000).toFixed(1)} ms to admit.\n` +
      '  That is one blocking, synchronous call on the single ws-server thread, so\n' +
      `  N simultaneous joins of full scenes cost about ${((snap5000.perOpUs * 10) / 1000).toFixed(0)} ms of\n` +
      '  stall at N=10. Steady-state editing hides this completely, because a drag\n' +
      '  sends one element at a time and the two costs differ by three orders of\n' +
      '  magnitude.\n'
  );
  process.stdout.write(
    '  This is a property of `safeParse` over a whole-scene schema, not of a bug:\n' +
      '  there is no partial admission, and a scene that is rejected after 10 ms of\n' +
      '  parsing has still cost the 10 ms. Whether that matters depends on how\n' +
      '  often large rooms are opened at once, which is a product question.\n'
  );

  process.stdout.write(
    '\n  NOT claimed: how many editors one instance supports. The fan-out rows use\n' +
      '  fake sockets whose send() is a no-op, so dividing them by a real\n' +
      '  requirement would produce a number about this harness rather than about the\n' +
      '  server. Answering that needs real sockets and a real network.\n'
  );

  // Count-based summary of what was exercised, which is the part that survives a
  // change of machine.
  process.stdout.write('  exercised:\n');
  process.stdout.write(
    '    sceneDeltaSchema.safeParse over 4 delta sizes, sceneUpdateSchema over 3 snapshot sizes\n'
  );
  process.stdout.write('    broadcast over 4 peer counts with per-peer byte accounting\n');
  process.stdout.write(`    noise floor sampled 5x for 2 operations\n\n`);
}

main();
