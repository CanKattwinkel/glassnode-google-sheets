// Auth.js against stubbed Apps Script services: a refresh that finishes after
// a sign-out or a new sign-in must not write over the newer state.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(onRefresh) {
  const props = {};
  const ctx = {
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperties: () => ({...props}),
        setProperties: p => Object.assign(props, p),
        setProperty: (k, v) => (props[k] = v),
        deleteProperty: k => delete props[k],
      }),
    },
    // The lock is unavailable: the worst case, where only the session check protects.
    LockService: {getDocumentLock: () => ({tryLock: () => false, releaseLock: () => {}})},
    CacheService: {getUserCache: () => ({get: () => null, put: () => {}, remove: () => {}})},
    SpreadsheetApp: {getActive: () => ({getId: () => 'sheet'})},
    Utilities: {
      getUuid: () => 'session-' + Math.random(),
      newBlob: b => ({getDataAsString: () => b}),
      base64DecodeWebSafe: s => Buffer.from(s, 'base64url').toString(),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        let body = {};
        if (opts.payload.grant_type === 'refresh_token') body = onRefresh(ctx);
        return {getResponseCode: () => 200, getContentText: () => JSON.stringify(body)};
      },
    },
  };
  vm.createContext(ctx);
  for (const f of ['Config.js', 'Lib.js', 'Auth.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, {filename: f});
  }
  // An expired session for account A.
  Object.assign(props, {
    GN_ACCESS_TOKEN: 'access-a1', GN_REFRESH_TOKEN: 'refresh-a', GN_EXPIRES_AT: '1',
    GN_USER: 'a@example.test', GN_SESSION_ID: 'session-a',
  });
  return {ctx, props};
}

const idToken = email => 'x.' + Buffer.from(JSON.stringify({email})).toString('base64url') + '.y';

test('auth: sign-out during a refresh stays signed out', () => {
  const {ctx, props} = load(c => {
    c.gnClearSession_(); // what gnAuthSignOut does once its revoke returns
    return {access_token: 'access-a2', expires_in: 3600};
  });
  assert.throws(() => ctx.gnGetAccessToken_(), /Not signed in/);
  assert.strictEqual(props.GN_ACCESS_TOKEN, undefined);
  assert.strictEqual(ctx.gnAuthStatus().signedIn, false);
});

test('auth: a new sign-in during a refresh keeps the new account whole', () => {
  const {ctx, props} = load(c => {
    c.gnSaveTokens_({access_token: 'access-b', refresh_token: 'refresh-b', expires_in: 3600,
      id_token: idToken('b@example.test')}, true);
    return {access_token: 'access-a2', expires_in: 3600};
  });
  assert.strictEqual(ctx.gnGetAccessToken_(), 'access-b');
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-b');
  assert.strictEqual(props.GN_REFRESH_TOKEN, 'refresh-b');
  assert.strictEqual(props.GN_USER, 'b@example.test');
});

test('auth: a normal refresh is saved', () => {
  const {ctx, props} = load(() => ({access_token: 'access-a2', expires_in: 3600}));
  assert.strictEqual(ctx.gnGetAccessToken_(), 'access-a2');
  assert.strictEqual(props.GN_ACCESS_TOKEN, 'access-a2');
});
