/**
 * Minimal Upstash-REST-protocol shim in front of a real Redis server.
 *
 * WHY THIS EXISTS: `@upstash/redis` speaks only the Upstash **REST** API, never
 * the Redis wire protocol. That is the whole point of the dependency — it is
 * what makes Upstash work from serverless runtimes — and it also means a plain
 * `redis:6379` container cannot be dropped in as `UPSTASH_REDIS_REST_URL`.
 * To exercise the lease code against a real Redis (real Lua, real SET NX PX,
 * real TTL expiry) this process terminates that REST surface and forwards to a
 * real Redis over TCP.
 *
 * Endpoints implemented, matching https://upstash.com/docs/redis/features/restapi:
 *   POST/GET /<command>/<arg>/<arg>/...   -> {"result": ...} | {"error": "..."}
 *   POST /pipeline                        -> [{"result":...},...]   (non-atomic)
 *   POST /multi-exec                      -> [{"result":...},...]   (atomic)
 *   POST /subscribe/<channel|pattern>     -> SSE stream of message events
 *
 * It also records every command it forwards, so the caller can count Redis
 * commands per scene mutation instead of guessing at it.
 *
 * Not part of the server: run it by hand for verification, never in production.
 */
import net from 'node:net';
import http from 'node:http';

/** RESP request encoder: every argument is sent as a bulk string. */
function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const text = typeof arg === 'string' ? arg : JSON.stringify(arg);
    const bytes = Buffer.byteLength(text, 'utf8');
    parts.push(`$${bytes}\r\n`, text, '\r\n');
  }
  return parts.join('');
}

/** Incremental RESP reply parser (sufficient for the reply types Redis returns here). */
class RespReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  drain() {
    for (;;) {
      const reply = this.tryParse();
      if (!reply) return;
      const waiter = this.waiters.shift();
      if (waiter) waiter(reply);
      // Replies with no waiter are dropped. `tryParse` returning a reply always
      // advanced the buffer, so this loop always terminates.
    }
  }

  /**
   * Parse one reply, or return null if the buffer does not yet hold a complete
   * one. The snapshot/restore wrapper matters: an array element that is itself
   * incomplete must leave the buffer exactly as it found it, or the next
   * `drain()` re-reads from a desynchronised offset and spins forever.
   */
  tryParse() {
    const snapshot = this.buffer;
    const result = this.tryParseInner();
    if (!result) this.buffer = snapshot;
    return result;
  }

  tryParseInner(depth = 0) {
    // A depth guard turns a parser desync into a diagnosable error instead of a
    // stack overflow that takes the shim (and with it the proof) down silently.
    if (depth > 16) {
      throw new Error(
        `RESP nesting exceeded 16; first bytes: ${this.buffer.subarray(0, 64).toString('hex')}`
      );
    }
    if (this.buffer.length === 0) return null;
    const start = this.buffer.indexOf(0x0d);
    if (start === -1) return null;
    const type = String.fromCharCode(this.buffer[0]);
    const header = this.buffer.subarray(1, start).toString('utf8');
    const headerLength = start + 2;

    switch (type) {
      case '+':
        this.buffer = this.buffer.subarray(headerLength);
        return { kind: 'status', value: header };
      case '-':
        this.buffer = this.buffer.subarray(headerLength);
        return { kind: 'error', value: header };
      case ':':
        this.buffer = this.buffer.subarray(headerLength);
        return { kind: 'integer', value: Number(header) };
      case '$': {
        const size = Number(header);
        if (size === -1) {
          this.buffer = this.buffer.subarray(headerLength);
          return { kind: 'nil', value: null };
        }
        if (this.buffer.length < headerLength + size + 2) return null;
        const value = this.buffer.subarray(headerLength, headerLength + size).toString('utf8');
        this.buffer = this.buffer.subarray(headerLength + size + 2);
        return { kind: 'bulk', value };
      }
      case '*': {
        // Advance past the array header before reading elements. Without this
        // every element re-parses the `*N` header itself and recurses forever.
        this.buffer = this.buffer.subarray(headerLength);
        const count = Number(header);
        if (count === -1) {
          return { kind: 'nil', value: null };
        }
        // A nested array is the reply shape the @upstash/ratelimit Lua returns;
        // anything beyond a plausible element count is a desync, not a reply.
        if (!Number.isInteger(count) || count < 0 || count > 1_000_000) {
          throw new Error(
            `implausible RESP array length "${header}"; first bytes: ${this.buffer.subarray(0, 64).toString('hex')}`
          );
        }
        const items = [];
        for (let i = 0; i < count; i += 1) {
          const item = this.tryParseInner(depth + 1);
          if (!item) return null;
          items.push(item.value);
        }
        return { kind: 'array', value: items };
      }
      default:
        this.buffer = this.buffer.subarray(headerLength);
        return { kind: 'error', value: `unsupported RESP type ${type}` };
    }
  }

  next() {
    return new Promise(resolve => {
      this.waiters.push(resolve);
      this.drain();
    });
  }
}

/**
 * One pooled connection per concurrent command stream. A single shared
 * connection would need a demultiplexing reply queue; commands here are issued
 * one at a time per shim request and pub/sub uses its own connection, so a
 * small pool with checkout is both simpler and enough.
 */
class RedisConnectionPool {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.idle = [];
    this.size = 0;
    this.max = 8;
  }

  async acquire() {
    const existing = this.idle.pop();
    if (existing && !existing.broken) return existing;
    if (this.size < this.max) {
      this.size += 1;
      const socket = net.connect({ host: this.host, port: this.port });
      const reader = new RespReader();
      socket.on('data', chunk => reader.push(chunk));
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      return { socket, reader, broken: false };
    }
    await new Promise(resolve => setTimeout(resolve, 2));
    return this.acquire();
  }

  release(connection) {
    if (connection.broken) {
      connection.socket.destroy();
      this.size -= 1;
      return;
    }
    this.idle.push(connection);
  }

  async command(args) {
    const connection = await this.acquire();
    try {
      // No stale-reply drain: every command below reads exactly one reply, so
      // an idle connection's reader is always positioned at a reply boundary.
      // Registering a throwaway waiter *before* writing would instead consume
      // this command's own reply and hang forever on the next read.
      connection.socket.write(encodeCommand(args));
      const reply = await connection.reader.next();
      return reply;
    } catch (err) {
      connection.broken = true;
      connection.socket.destroy();
      // Reject so a malformed reply fails the one HTTP request that caused it
      // instead of desynchronising this connection for every later command.
      return { kind: 'error', value: `${err.message} [cmd: ${String(args[0]).toUpperCase()}]` };
    } finally {
      this.release(connection);
    }
  }

  /** Dedicated connection for a long-lived (pub/sub) command. */
  async subscribe(args, onEvent, onError) {
    const socket = net.connect({ host: this.host, port: this.port });
    const reader = new RespReader();
    socket.on('data', chunk => reader.push(chunk));
    socket.on('error', err => onError?.(err));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(encodeCommand(args));
    // RESP pub/sub pushes unsolicited arrays forever; feed them to the caller.
    for (;;) {
      const reply = await reader.next();
      if (reply.kind === 'error') {
        onError?.(new Error(reply.value));
        return;
      }
      if (reply.kind === 'array') onEvent(reply.value);
    }
  }
}

function replyToJson(reply) {
  switch (reply.kind) {
    case 'status':
    case 'bulk':
      return reply.value;
    case 'integer':
      return reply.value;
    case 'nil':
      return null;
    case 'array':
      return reply.value.map(replyToJson);
    default:
      return null;
  }
}

export function createUpstashRestShim({ redisHost, redisPort, httpPort, quiet = false }) {
  const pool = new RedisConnectionPool(redisHost, redisPort);
  /** Every forwarded command, in order. The hot-path cost claim is a count of these. */
  const commandLog = [];
  const subscriptions = new Set();

  const record = (args, source) => {
    commandLog.push({ command: String(args[0]).toUpperCase(), args, source, at: Date.now() });
  };

  const run = (args, source) => {
    const entry = { command: String(args[0]).toUpperCase(), args, source, at: Date.now() };
    commandLog.push(entry);
    if (!quiet) process.stderr.write(`[shim:${source}] > ${args[0]}\n`);
    return pool.command(normaliseForStockRedis(args)).then(reply => {
      // `done` is what makes a hang diagnosable: an entry with no matching
      // `done` is a command that never came back from Redis.
      entry.done = true;
      if (!quiet) {
        process.stderr.write(
          `[shim:${source}] < ${args[0]} ${reply?.kind}:${JSON.stringify(replyToJson(reply))?.slice(0, 80)}\n`
        );
      }
      return reply;
    });
  };

  /**
   * `@upstash/ratelimit` ships its Lua with an Upstash-only shebang,
   * `#!lua flags=allow-key-locking`, which stock Redis rejects with
   * "ERR Unexpected flag in script shebang". The flag only relaxes Upstash's
   * key-locking restriction; on a real single-node Redis there is nothing to
   * relax. Strip the shebang line before forwarding, so this shim can stand in
   * for Upstash without silently becoming a different rate limiter.
   */
  function normaliseForStockRedis(args) {
    const verb = String(args[0] ?? '').toUpperCase();
    // EVALSHA carries only a digest (the script was loaded by a prior EVAL), so
    // there is nothing to rewrite.
    if (verb !== 'EVAL') return args;
    if (typeof args[1] === 'string' && args[1].startsWith('#!')) {
      const body = args[1].split('\n').slice(1).join('\n');
      return [args[0], body, ...args.slice(2)];
    }
    return args;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const body = Buffer.concat(chunks).toString('utf8');

        // --- pub/sub: SSE. `@upstash/redis` uses `POST /subscribe/<channel>` and
        // `POST /psubscribe/<pattern>` with `Accept: text/event-stream`, and its
        // frames are COMMA-SEPARATED, not JSON: `pmessage,<pattern>,<channel>,<payload>`.
        // Getting that framing wrong fails silently — the client just never
        // receives a message — so it is worth stating explicitly.
        const subscribeMatch = /^\/(p?subscribe)\/(.+)$/.exec(url.pathname);
        if (subscribeMatch) {
          const isPattern = subscribeMatch[1] === 'psubscribe';
          const target = decodeURIComponent(subscribeMatch[2]);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          const send = frame => res.write(`data: ${frame}\n\n`);
          const entry = {
            pattern: isPattern ? target : null,
            channel: isPattern ? null : target,
            send,
          };
          subscriptions.add(entry);
          send(`${isPattern ? 'psubscribe' : 'subscribe'},${target},1`);
          const command = [isPattern ? 'PSUBSCRIBE' : 'SUBSCRIBE', target];
          record(command, 'subscribe');
          pool
            .subscribe(
              command,
              values => {
                const kind = String(values[0]);
                if (kind === 'pmessage') {
                  const pattern = String(values[1]);
                  const channel = String(values[2]);
                  const message = String(values[3]);
                  for (const subscriber of subscriptions) {
                    if (!subscriber.pattern) continue;
                    if (
                      subscriber.pattern === pattern ||
                      matchPattern(subscriber.pattern, channel)
                    ) {
                      subscriber.send(`pmessage,${pattern},${channel},${message}`);
                    }
                  }
                  return;
                }
                if (kind === 'message') {
                  const channel = String(values[1]);
                  const message = String(values[2]);
                  for (const subscriber of subscriptions) {
                    if (subscriber.channel === channel)
                      subscriber.send(`message,${channel},${message}`);
                  }
                }
              },
              err => process.stderr.write(`shim subscribe: ${err}\n`)
            )
            .catch(() => undefined);
          req.on('close', () => subscriptions.delete(entry));
          return;
        }

        const json = payload => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };

        try {
          if (url.pathname === '/pipeline' || url.pathname === '/multi-exec') {
            const commands = JSON.parse(body);
            const results = [];
            if (url.pathname === '/multi-exec') await run(['MULTI'], 'multi-exec');
            for (const command of commands) {
              const reply = await run(command, url.pathname.slice(1));
              results.push(
                reply.kind === 'error' ? { error: reply.value } : { result: replyToJson(reply) }
              );
            }
            if (url.pathname === '/multi-exec') await run(['EXEC'], 'multi-exec');
            json(results);
            return;
          }

          // Single command. Upstash sends it either as path segments or as a
          // JSON array body, and appends the body as the last argument.
          let args;
          const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
          if (segments.length > 0) {
            args = segments;
            if (body) args.push(body);
          } else {
            args = JSON.parse(body);
          }
          const reply = await run(args, 'single');
          json(reply.kind === 'error' ? { error: reply.value } : { result: replyToJson(reply) });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        }
      })();
    });
  });

  return {
    server,
    commandLog,
    resetCommandLog: () => {
      commandLog.length = 0;
    },
    listen: () =>
      new Promise(resolve => {
        server.listen(httpPort, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () => new Promise(resolve => server.close(() => resolve(undefined))),
  };
}

function matchPattern(pattern, channel) {
  const source = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(channel);
}

// Standalone mode: `node scripts/upstash-rest-shim.mjs [httpPort] [redisHost] [redisPort]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const httpPort = Number(process.argv[2] ?? 8099);
  const redisHost = process.argv[3] ?? '127.0.0.1';
  const redisPort = Number(process.argv[4] ?? 6379);
  const shim = createUpstashRestShim({ redisHost, redisPort, httpPort, quiet: false });
  shim.listen().then(port => {
    process.stderr.write(
      `upstash-rest-shim listening on ${port} -> redis://${redisHost}:${redisPort}\n`
    );
  });
}
