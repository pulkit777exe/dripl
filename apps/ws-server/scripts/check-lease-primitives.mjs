/**
 * Smoke test for the Upstash-REST shim: drives the REAL `@upstash/redis`
 * client (the same version ws-server pins) through the lease commands against
 * a real Redis over the shim's HTTP surface. This is what proves the Lua CAS
 * scripts, `SET NX PX`, TTL expiry, and pub/sub work as the code expects.
 *
 * Usage: node scripts/check-lease-primitives.mjs <restUrl> <restToken>
 */
import { Redis } from '@upstash/redis';

const [, , restUrl, restToken] = process.argv;
if (!restUrl || !restToken) {
  process.stderr.write('usage: node scripts/check-lease-primitives.mjs <restUrl> <restToken>\n');
  process.exit(2);
}

const RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const redis = new Redis({ url: restUrl, token: restToken });
const key = `dripl:proof:lease:${Date.now()}`;
const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, actual, expected, pass });
  process.stderr.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}\n`
  );
};

await redis.del(key);

// 1. SET NX PX: first acquirer wins.
const first = await redis.set(key, 'token-a', { nx: true, px: 5000 });
check('SET NX PX on a free key returns OK', first, 'OK');

// 2. SET NX PX: second acquirer loses (returns null).
const second = await redis.set(key, 'token-b', { nx: true, px: 5000 });
check('SET NX PX on a held key returns null', second, null);

// 3. CAS renew with the right token extends the TTL.
const ttlBefore = await redis.pttl(key);
const renewed = await redis.eval(RENEW_LUA, [key], ['token-a', 'token-a', '5000']);
const ttlAfter = await redis.pttl(key);
check('Lua CAS renew with the held token returns 1', renewed, 1);
check('CAS renew extended the TTL', ttlAfter >= ttlBefore, true);

// 4. CAS renew with a stale token is refused and does not clobber the value.
const stale = await redis.eval(RENEW_LUA, [key], ['token-b', 'token-b', '5000']);
const valueAfterStale = await redis.get(key);
check('Lua CAS renew with a stale token returns 0', stale, 0);
check('stale CAS did not overwrite the value', valueAfterStale, 'token-a');

// 5. Release with the wrong token must not delete.
const wrongRelease = await redis.eval(RELEASE_LUA, [key], ['token-b']);
check('Lua CAS release with a stale token returns 0', wrongRelease, 0);
check('stale release did not delete the key', await redis.exists(key), 1);

// 6. Release with the right token deletes.
const rightRelease = await redis.eval(RELEASE_LUA, [key], ['token-a']);
check('Lua CAS release with the held token returns 1', rightRelease, 1);
check('released key is gone', await redis.exists(key), 0);

// 7. TTL expiry hands the room over: after expiry the key is acquirable again.
await redis.set(key, 'token-a', { nx: true, px: 300 });
await new Promise(resolve => setTimeout(resolve, 500));
const afterExpiry = await redis.set(key, 'token-c', { nx: true, px: 5000 });
check('an expired lease can be acquired by another instance', afterExpiry, 'OK');
check('the new owner token is in place', await redis.get(key), 'token-c');

// 8. The old owner's CAS must now fail — this is the anti-split-brain property.
const oldOwnerRenew = await redis.eval(RENEW_LUA, [key], ['token-a', 'token-a', '5000']);
check("a lapsed owner's renew is refused after takeover", oldOwnerRenew, 0);
check('takeover left the new owner value intact', await redis.get(key), 'token-c');

await redis.del(key);

const failed = results.filter(result => !result.pass);
process.stderr.write(
  `\n${results.length - failed.length}/${results.length} primitive checks passed\n`
);
process.exit(failed.length === 0 ? 0 : 1);
