import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

/**
 * A peer must not be able to kill this process with one packet.
 *
 * `ws` reports a frame it cannot parse by emitting `'error'` on the socket
 * (`receiverOnError`). `WebSocket` is an `EventEmitter`, and an EventEmitter
 * *throws* on an `'error'` event that has no listener — so before these
 * listeners existed, a single text frame whose payload is not valid UTF-8
 * reached `throw er; // Unhandled 'error' event` and terminated the process,
 * discarding every in-memory `RoomState` it was authoritative for.
 *
 * The socket here deliberately completes no ticket handshake: the assertion is
 * that a frame arriving before authentication cannot reach the process-level
 * throw, because the listener is attached in the `connection` handler.
 */

const dbMock = {
  initializeDb: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
  file: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn().mockResolvedValue([]),
  },
  canvasRoom: {
    findUnique: vi.fn().mockResolvedValue(null),
    updateManyAndReturn: vi.fn().mockResolvedValue([]),
  },
};

const warnSpy = vi.fn();
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('@dripl/db', () => ({
  db: dbMock,
  initializeDb: dbMock.initializeDb,
}));

let port = 0;
let stopForTests: () => Promise<void>;

/** Raw client: one handshake, then an invalid-UTF8 text frame. */
function sendInvalidUtf8Frame(targetPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(targetPort, '127.0.0.1', () => {
      socket.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
          'Sec-WebSocket-Version: 13\r\nOrigin: http://localhost:3000\r\n\r\n'
      );
    });
    let handshake = '';
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 3_000);
    socket.on('error', reject);
    socket.on('data', chunk => {
      handshake += chunk.toString('latin1');
      if (!handshake.includes('\r\n\r\n')) return;
      clearTimeout(timer);
      socket.removeAllListeners('data');
      const payload = Buffer.from([0xff, 0xfe, 0xfd]);
      const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] as number)));
      socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 150);
    });
  });
}

describe('socket error isolation', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUN_WS_INTEGRATION', 'true');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@127.0.0.1:5432/test');
    vi.stubEnv('JWT_SECRET', 'ws-socket-error-secret');
    vi.stubEnv('INTERNAL_SECRET', 'ws-socket-error-internal');
    vi.stubEnv('HTTP_SERVER_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('WS_PORT', '0');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const module = await import('../index');
    stopForTests = module.stopForTests;
    const server = module.server;
    if (!server.listening) await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await stopForTests?.();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('answers the liveness probe without touching the database', async () => {
    // The probe a supervisor may safely restart on: process-up only.
    const response = await fetch(`http://127.0.0.1:${port}/live`);
    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: 'ok' });
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('survives an unparseable frame and still serves requests', async () => {
    await sendInvalidUtf8Frame(port);

    // Asserting only that the process survived is not enough, and in fact is
    // not sufficient to catch the regression: Vitest traps an unhandled
    // `'error'` emit and reports it without failing the test, so removing the
    // listener still produced a green run. Asserting that the listener
    // actually fired is deterministic and fails when the listener is gone.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ws_socket_error', code: 'WS_ERR_INVALID_UTF8' })
    );
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();

    const live = await fetch(`http://127.0.0.1:${port}/live`);
    expect(live.status).toBe(200);

    // A well-formed client handshake still works, so the bad peer took down
    // only its own socket rather than the listener.
    const healthy = new WebSocket(`ws://127.0.0.1:${port}/`, { origin: 'http://localhost:3000' });
    const closed = once(healthy, 'close');
    healthy.on('error', () => undefined);
    await once(healthy, 'open');
    healthy.close();
    await closed;
  });
});
