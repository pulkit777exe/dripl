-- Harness: executes the exact TICKET_CONSUME_LUA text (read from stdin) against
-- stubbed `redis`/`cjson` globals, across every branch of the script.
--
-- Why this exists: the driver test fakes the *client interface* (`set`/`eval`
-- as TypeScript methods), which proves the driver's serialization, TTL wiring,
-- and retry logic but never runs the Lua text itself. A typo in the script
-- would pass that suite and fail only against a live Redis. This file closes
-- that half of the gap by running the real script under LuaJIT (Lua 5.1
-- semantics, matching Redis) with a fake keyspace. What it still does not
-- prove is Upstash's REST round-trip of the reply — stated in `ports.ts`.
--
-- Protocol: prints `PASS <name>` per case, `ALL PASS` at the end. Any failed
-- assertion calls `error`, which exits nonzero with `FAIL ...` on stderr.

local script = io.read('*a')
assert(script and #script > 0, 'harness: no script on stdin')

-- Minimal JSON decoder, adequate for the {"principal":{...},"expiresAt":N}
-- values the driver writes. Fails loudly outside that shape rather than
-- guessing: a value this harness cannot parse is a test bug, not a pass.
local function decode(str)
  local pos = 1
  local function err(msg)
    error('json decode: ' .. msg .. ' at byte ' .. pos)
  end
  local function skipWs()
    while pos <= #str and string.find(string.sub(str, pos, pos), '%s') do
      pos = pos + 1
    end
  end
  local parseValue -- forward declaration for recursion
  local function parseString()
    pos = pos + 1 -- opening quote
    local out = {}
    while true do
      if pos > #str then
        err('unterminated string')
      end
      local c = string.sub(str, pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(out)
      elseif c == '\\' then
        local e = string.sub(str, pos + 1, pos + 1)
        if e == '"' or e == '\\' or e == '/' then
          table.insert(out, e)
          pos = pos + 2
        elseif e == 'n' then
          table.insert(out, '\n')
          pos = pos + 2
        elseif e == 't' then
          table.insert(out, '\t')
          pos = pos + 2
        elseif e == 'r' then
          table.insert(out, '\r')
          pos = pos + 2
        elseif e == 'b' then
          table.insert(out, '\b')
          pos = pos + 2
        elseif e == 'f' then
          table.insert(out, '\f')
          pos = pos + 2
        else
          err('unsupported escape \\' .. e)
        end
      else
        table.insert(out, c)
        pos = pos + 1
      end
    end
  end
  local function parseNumber()
    local num = string.match(string.sub(str, pos), '^-?%d+%.?%d*')
    if not num then
      err('bad number')
    end
    pos = pos + #num
    return tonumber(num)
  end
  local function parseObject()
    pos = pos + 1 -- opening brace
    local obj = {}
    skipWs()
    if string.sub(str, pos, pos) == '}' then
      pos = pos + 1
      return obj
    end
    while true do
      skipWs()
      if string.sub(str, pos, pos) ~= '"' then
        err('expected string key')
      end
      local key = parseString()
      skipWs()
      if string.sub(str, pos, pos) ~= ':' then
        err("expected ':'")
      end
      pos = pos + 1
      obj[key] = parseValue()
      skipWs()
      local c = string.sub(str, pos, pos)
      if c == '}' then
        pos = pos + 1
        return obj
      elseif c == ',' then
        pos = pos + 1
      else
        err("expected ',' or '}'")
      end
    end
  end
  parseValue = function()
    skipWs()
    local c = string.sub(str, pos, pos)
    if c == '"' then
      return parseString()
    elseif c == '{' then
      return parseObject()
    elseif c == 't' and string.sub(str, pos, pos + 3) == 'true' then
      pos = pos + 4
      return true
    elseif c == 'f' and string.sub(str, pos, pos + 4) == 'false' then
      pos = pos + 5
      return false
    elseif c == 'n' and string.sub(str, pos, pos + 3) == 'null' then
      pos = pos + 4
      return nil
    else
      return parseNumber()
    end
  end
  local value = parseValue()
  skipWs()
  if pos <= #str then
    err('trailing bytes')
  end
  return value
end

cjson = { decode = decode }

-- Declared before the stub: `redis.call` reads this local, and a `local`
-- declared after the function definition would not be in scope inside it
-- (the body would resolve the global instead, which is nil).
local NOW = 1000000
local TTL = 30000

-- The fake keyspace. `deadline` simulates the key TTL the driver's `SET ...
-- PX` installs: a GET past it reads as missing (passive expiry), exactly as
-- Redis behaves on access. `dels` counts explicit DEL calls so the cases can
-- tell "script deleted" from "key was already gone".
local store = {}
local dels = 0
redis = {
  call = function(cmd, key)
    if cmd == 'GET' then
      local entry = store[key]
      if entry == nil then
        return false
      end
      if entry.deadline <= NOW then
        store[key] = nil
        return false
      end
      return entry.value
    elseif cmd == 'DEL' then
      if store[key] ~= nil then
        store[key] = nil
        dels = dels + 1
        return 1
      end
      return 0
    else
      error('harness: unexpected redis.call ' .. tostring(cmd))
    end
  end,
}

local chunk, loadErr = loadstring(script)
assert(chunk, 'harness: script failed to compile: ' .. tostring(loadErr))

local function run(key, argvNow)
  KEYS = { key }
  ARGV = { tostring(argvNow) }
  return chunk()
end

local function check(name, cond)
  if not cond then
    error('FAIL ' .. name)
  end
  print('PASS ' .. name)
end

-- Values shaped exactly as the driver's `issue` writes them.
local liveValue =
  '{"principal":{"kind":"user","userId":"user-1"},"expiresAt":' .. (NOW + TTL) .. '}'
local staleValue =
  '{"principal":{"kind":"user","userId":"user-1"},"expiresAt":' .. (NOW - 1) .. '}'
local boundaryValue =
  '{"principal":{"kind":"user","userId":"user-1"},"expiresAt":' .. NOW .. '}'

-- 1. Absent key: nil, and no delete issued for a key that was never there.
dels = 0
check('missing key returns nil', run('dripl:ws-ticket:absent', NOW) == nil)
check('missing key issues no DEL', dels == 0)

-- 2. Live ticket: the value comes back and the key is spent.
store['dripl:ws-ticket:live'] = { value = liveValue, deadline = NOW + TTL }
dels = 0
check('live ticket returns its value', run('dripl:ws-ticket:live', NOW) == liveValue)
check('live ticket is deleted', store['dripl:ws-ticket:live'] == nil and dels == 1)

-- 3. Present but past its embedded deadline: refused AND reclaimed, which is
-- the branch that distinguishes this script from a bare GETDEL — the key
-- still exists (TTL not yet elapsed) but the driver's clock says it is dead.
store['dripl:ws-ticket:stale'] = { value = staleValue, deadline = NOW + TTL }
dels = 0
check('stale ticket returns nil', run('dripl:ws-ticket:stale', NOW) == nil)
check('stale ticket is deleted', store['dripl:ws-ticket:stale'] == nil and dels == 1)

-- 4. The boundary the memory driver pins: `expiresAt < now` refuses, so
-- equality is still live.
store['dripl:ws-ticket:edge'] = { value = boundaryValue, deadline = NOW + TTL }
check(
  'ticket at exactly expiresAt is live',
  run('dripl:ws-ticket:edge', NOW) == boundaryValue
)

-- 5. Single-shot: the key case 2 spent stays spent.
dels = 0
check('replay of a spent ticket returns nil', run('dripl:ws-ticket:live', NOW) == nil)
check('replay issues no DEL', dels == 0)

print('ALL PASS')
