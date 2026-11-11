// Auth.js against stubbed Apps Script services: session writes happen only
// under the document lock, and a late refresh or revoke never overwrites a
// newer sign-in or sign-out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// lockFree: whether tryLock can succeed. A held lock makes tryLock fail at once.
function load({lockFree = true, onRefresh = () => ({}), onRevoke = () => {}} = {}) {
  const props = {};
  const docCache = new Map();
  let held = false;
  const ctx = {
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperties: () => ({...props}),
        setProperties: p => Object.assign(props, p),
        setProperty: (k, v) => (props[k] = v),
        deleteProperty: k => delete props[k],
      }),
    },
    LockService: {
      getDocumentLock: () => {
        let mine = false;
        return {
          tryLock: () => (lockFree && !held ? (held = mine = true) : false),
          releaseLock: () => { if (mine) held = mine = false; },
        };
      },
    },
    CacheService: {
      getUserCache: () => ({get: () => 'device', put: () => {}, remove: () => {}}),
      getDocumentCache: () => ({get: k => docCache.get(k) || null, put: (k, v) => docCache.set(k, v), remove: k => docCache.delete(k)}),
    },
    SpreadsheetApp: {getActive: () => ({getId: () => 'sheet'})},
    Utilities: {
      getUuid: () => 'session-' + Math.random(),
      newBlob: b => ({getDataAsString: () => b}),
      base64DecodeWebSafe: s => Buffer.from(s, 'base64url').toString(),
      computeDigest: (alg, str) => [...Buffer.from(str)],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      DigestAlgorithm: {MD5: 'MD5'},
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        if (url.includes('/v1/')) return {getResponseCode: () => 200, getContentText: () => '[{"t":1,"v":"' + opts.headers.Authorization + '"}]', getHeaders: () => ({})};
        let body = {};
        if (opts.payload.grant_type === 'refresh_token') body = onRefresh(ctx);
        if (url.endsWith('/oauth/revoke')) onRevoke(ctx);
        if (opts.payload.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') body = tokensB;
        return {getResponseCode: () => (body.error ? 400 : 200), getContentText: () => JSON.stringify(body)};
      },
    },
  };
  vm.createContext(ctx);
  for (const f of ['Config.js', 'Lib.js', 'Auth.js', 'Api.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, {filename: f});
  }
  // An expired session for account A.
  Object.assign(props, {
    GN_ACCESS_TOKEN: 'access-a1', GN_REFRESH_TOKEN: 'refresh-a', GN_EXPIRES_AT: '1',
    GN_USER: 'a@example.test', GN_SESSION_ID: 'session-a',
  });
  return {ctx, props, docCache};
}

const idToken = email => 'x.' + Buffer.from(JSON.stringify({email})).toString('base64url') + '.y';
const tokensB = {access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600, id_token: idToken('b@example.test')};
const refreshed = () => ({access_token: 'access-a2', expires_in: 3600});

test('auth: a normal refresh is saved', () => {
  const {ctx, props} = load({onRefresh: refreshed});
  assert.strictEqual(ctx.gnGetAccessToken_(), 'access-a2');
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-a2');
});

test('auth: without the lock a refresh uses its token but writes nothing', () => {
  const {ctx, props} = load({lockFree: false, onRefresh: refreshed});
  assert.strictEqual(ctx.gnGetAccessToken_(), 'access-a2');
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-a1');
});

test('auth: without the lock a rejected refresh clears nothing', () => {
  const {ctx, props} = load({lockFree: false, onRefresh: () => ({error: 'invalid_grant'})});
  assert.throws(() => ctx.gnGetAccessToken_(), /expired/);
  assert.strictEqual(props.GN_REFRESH_TOKEN, 'refresh-a');
});

test('auth: sign-out during a refresh waits for it instead of being overwritten', () => {
  let signOut;
  const {ctx, props} = load({onRefresh: c => { signOut = () => c.gnAuthSignOut(); assert.throws(signOut, /busy/); return refreshed(); }});
  ctx.gnGetAccessToken_();
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-a2'); // the refresh finished, sign-out was refused
  signOut();
  assert.strictEqual(props.GN_ACCESS_TOKEN, undefined);
  assert.strictEqual(ctx.gnAuthStatus().signedIn, false);
});

test('auth: sign-in during a refresh is refused, not mixed with the old account', () => {
  const {ctx, props} = load({onRefresh: c => { assert.strictEqual(c.gnAuthPoll().status, 'error'); return refreshed(); }});
  ctx.gnGetAccessToken_();
  assert.strictEqual(props.GN_REFRESH_TOKEN, 'refresh-a');
  assert.strictEqual(props.GN_USER, 'a@example.test');
});

test('auth: a sign-in during the sign-out revoke is kept', () => {
  const {ctx, props} = load({onRevoke: c => assert.strictEqual(c.gnAuthPoll().status, 'ok')});
  ctx.gnAuthSignOut();
  assert.strictEqual(props.GN_REFRESH_TOKEN, 'refresh-b');
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-b');
  assert.strictEqual(props.GN_USER, 'b@example.test');
});

test('auth: an access token without a session ID is not signed in', () => {
  const {ctx, props} = load();
  Object.assign(props, {GN_EXPIRES_AT: String(Date.now() + 3600e3)});
  delete props.GN_REFRESH_TOKEN; delete props.GN_SESSION_ID;
  assert.strictEqual(ctx.gnAuthStatus().signedIn, false);
  assert.throws(() => ctx.gnGetAccessToken_(), /expired/);
});

test('api: data fetched with the old account is never cached under a new session', () => {
  // The refresh can't get the lock; account B signs in while it runs.
  const {ctx, props, docCache} = load({lockFree: false, onRefresh: () => {
    Object.assign(props, {GN_ACCESS_TOKEN: 'access-b', GN_REFRESH_TOKEN: 'refresh-b', GN_EXPIRES_AT: String(Date.now() + 3600e3), GN_SESSION_ID: 'session-b'});
    return refreshed();
  }});
  ctx.gnApiGet_('/v1/metrics/market/price_usd_close', {a: 'BTC'}, 60);
  for (const [key, value] of docCache) {
    // The stub digest is the identity, so the key decodes to "<session ID>|<epoch>|<url>".
    const session = Buffer.from(key.slice(3), 'base64url').toString().split('|')[0];
    if (value.includes('access-a2')) assert.notStrictEqual(session, 'session-b', 'A data under B key');
  }
  // B's lookup misses and fetches with B's token.
  assert.match(JSON.stringify(ctx.gnApiGet_('/v1/metrics/market/price_usd_close', {a: 'BTC'}, 60)), /access-b/);
});
