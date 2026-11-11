const test = require('node:test');
const assert = require('node:assert');
const lib = require('../src/Lib.js');

const fmtUtc = d => d.toISOString().slice(0, 10);
const iso = sec => new Date(sec * 1000).toISOString().slice(0, 10);

test('date: YYYY-MM-DD string is UTC midnight', () => {
  assert.strictEqual(lib.gnDateToUnix_('2025-01-01', fmtUtc, 'startDate'), 1735689600);
  assert.strictEqual(lib.gnDateToUnix_(' 2025-01-01 ', fmtUtc, 'startDate'), 1735689600);
});

test('date: Date cell uses the calendar day in the sheet time zone', () => {
  // Midnight 2025-01-01 in New York is 05:00 UTC; midnight in Tokyo is 15:00 UTC the day before.
  const ny = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'}).format(d);
  const tokyo = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tokyo'}).format(d);
  assert.strictEqual(lib.gnDateToUnix_(new Date('2025-01-01T05:00:00Z'), ny, 's'), 1735689600);
  assert.strictEqual(lib.gnDateToUnix_(new Date('2024-12-31T15:00:00Z'), tokyo, 's'), 1735689600);
});

test('date: serial number', () => {
  assert.strictEqual(lib.gnDateToUnix_(45658, fmtUtc, 's'), 1735689600); // 2025-01-01
  assert.strictEqual(lib.gnDateToUnix_(45658.75, fmtUtc, 's'), 1735689600);
});

test('date: rejects bad input', () => {
  for (const bad of ['01/01/2025', '2025-13-01', '2025-02-30', '', true, {}, new Date('x'), -5]) {
    assert.throws(() => lib.gnDateToUnix_(bad, fmtUtc, 'startDate'), /startDate/);
  }
});

test('params: key=value, ranges, pick, blanks', () => {
  assert.deepStrictEqual(lib.gnParseParams_(['e=binance', '', [['i=1h'], [' c = usd ']], 'pick=mean', null]), {
    params: {e: 'binance', i: '1h', c: 'usd'},
    pick: 'mean',
  });
  assert.deepStrictEqual(lib.gnParseParams_([]), {params: {}, pick: null});
  assert.deepStrictEqual(lib.gnParseParams_(['q=a=b']).params, {q: 'a=b'});
});

test('params: rejects malformed and api_key', () => {
  assert.throws(() => lib.gnParseParams_(['binance']), /key=value/);
  assert.throws(() => lib.gnParseParams_(['e=']), /key=value/);
  assert.throws(() => lib.gnParseParams_(['=x']), /key=value/);
  assert.throws(() => lib.gnParseParams_(['api_key=abc']), /Sign in/);
});

test('query string is sorted and encoded', () => {
  assert.strictEqual(lib.gnQueryString_({s: '1', a: 'BTC', e: 'a b&c'}), 'a=BTC&e=a%20b%26c&s=1');
});

test('shape: value metric', () => {
  const rows = [{t: 1735689600, v: 1}, {t: 1735776000, v: null}];
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/x', true, null, iso), [[1]]);
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/x', false, null, iso), [
    ['Date', '/m/x'],
    ['2025-01-01', 1],
    ['2025-01-02', ''],
  ]);
  assert.deepStrictEqual(lib.gnShapeMetric_([{t: 1, v: 0}], '/m/x', true, null, iso), [[0]]);
  assert.throws(() => lib.gnShapeMetric_(rows, '/m/x', false, 'a', iso), /pick/);
});

test('shape: object metric', () => {
  const rows = [{t: 1735689600, o: {b: 2, a: 1}}, {t: 1735776000, o: {a: 3, c: 4}}];
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/o', false, null, iso), [
    ['Date', '/m/o.a', '/m/o.b', '/m/o.c'],
    ['2025-01-01', 1, 2, ''],
    ['2025-01-02', 3, '', 4],
  ]);
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/o', false, 'a', iso), [
    ['Date', '/m/o.a'],
    ['2025-01-01', 1],
    ['2025-01-02', 3],
  ]);
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/o', true, 'b', iso), [[2]]);
  assert.deepStrictEqual(lib.gnShapeMetric_(rows, '/m/o', true, null, iso), [
    ['Date', '/m/o.a', '/m/o.b'],
    ['2025-01-01', 1, 2],
  ]);
  assert.throws(() => lib.gnShapeMetric_(rows, '/m/o', false, 'zzz', iso), /Available: a, b, c/);
});

test('shape: empty and unsupported', () => {
  assert.throws(() => lib.gnShapeMetric_([], '/m/x', false, null, iso), /No data/);
  assert.throws(() => lib.gnShapeMetric_({}, '/m/x', false, null, iso), /Unexpected/);
  assert.throws(() => lib.gnShapeMetric_([{t: 1, x: 1}], '/m/x', false, null, iso), /not supported/);
});

test('jwt payload', () => {
  const b64 = s => Buffer.from(s, 'base64url').toString();
  const jwt = 'h.' + Buffer.from('{"email":"a@b.c"}').toString('base64url') + '.s';
  assert.deepStrictEqual(lib.gnJwtPayload_(jwt, b64), {email: 'a@b.c'});
  assert.deepStrictEqual(lib.gnJwtPayload_('garbage', b64), {});
  assert.deepStrictEqual(lib.gnJwtPayload_(undefined, b64), {});
});

test('ttl: historic vs live ranges', () => {
  const now = Date.UTC(2025, 5, 10, 12);
  const at = (...a) => Date.UTC(...a) / 1000;
  assert.strictEqual(lib.gnMetricTtl_(at(2025, 0, 6), now, 21600, 300), 21600);
  assert.strictEqual(lib.gnMetricTtl_(at(2025, 5, 9, 11), now, 21600, 300), 21600);
  assert.strictEqual(lib.gnMetricTtl_(at(2025, 5, 9, 13), now, 21600, 300), 300); // ended < 1 day ago
  assert.strictEqual(lib.gnMetricTtl_(at(2025, 5, 10), now, 21600, 300), 300);
  assert.strictEqual(lib.gnMetricTtl_(at(2026, 0, 1), now, 21600, 300), 300); // future end
});

test('rate limit headers', () => {
  const now = 1_750_000_000_000;
  assert.deepStrictEqual(
    lib.gnParseRateLimit_({'x-rate-limit-limit': '5', 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '19'}, now),
    {remaining: 0, resetMs: 19000}
  );
  assert.deepStrictEqual(lib.gnParseRateLimit_({'X-Rate-Limit-Remaining': 42, 'X-Rate-Limit-Reset': 3}, now), {
    remaining: 42,
    resetMs: 3000,
  });
  // absolute epoch seconds
  assert.deepStrictEqual(lib.gnParseRateLimit_({'x-rate-limit-reset': String(now / 1000 + 30)}, now), {
    remaining: null,
    resetMs: 30000,
  });
  assert.deepStrictEqual(lib.gnParseRateLimit_({'Retry-After': '7'}, now), {remaining: null, resetMs: 7000});
  assert.deepStrictEqual(lib.gnParseRateLimit_({}, now), {remaining: null, resetMs: null});
  assert.deepStrictEqual(lib.gnParseRateLimit_({'x-rate-limit-remaining': 'abc', 'x-rate-limit-reset': ''}, now), {
    remaining: null,
    resetMs: null,
  });
});

test('metric path: plain API paths only', () => {
  assert.ok(lib.gnIsMetricPath_('/market/price_usd_close'));
  assert.ok(lib.gnIsMetricPath_('/derivatives/futures-open_interest_sum'));
  for (const bad of ['', '/', 'market/price', '/market/', '/market//price', '/../user', '/market/..',
    '/market/price?x=1', '/market/price#x', '/market/price%2F..', '/market/price usd', '/market/price\n']) {
    assert.strictEqual(lib.gnIsMetricPath_(bad), false, JSON.stringify(bad));
  }
});

test('session: same only while refresh token and session ID are unchanged', () => {
  const a = {refreshToken: 'r1', sessionId: 's1'};
  assert.ok(lib.gnSameSession_(a, {refreshToken: 'r1', sessionId: 's1'}));
  assert.strictEqual(lib.gnSameSession_(a, {refreshToken: '', sessionId: ''}), false);
  assert.strictEqual(lib.gnSameSession_(a, {refreshToken: 'r2', sessionId: 's2'}), false);
  assert.strictEqual(lib.gnSameSession_({refreshToken: '', sessionId: ''}, {refreshToken: '', sessionId: ''}), false);
});
