/**
 * Glassnode sign-in via the Auth0 device authorization flow.
 *
 * The session (access + refresh token) is stored in the spreadsheet's document
 * properties, so formulas work for everyone who can use the sheet and run on
 * the account of the person who signed in. Custom functions cannot read
 * per-user storage, which is why the session is per spreadsheet.
 *
 * Functions ending in "_" are private: they cannot be called from a cell or
 * from the sidebar. Nothing public ever returns a token.
 */

var GN_PROP_ = {
  access: 'GN_ACCESS_TOKEN',
  refresh: 'GN_REFRESH_TOKEN',
  expiresAt: 'GN_EXPIRES_AT', // epoch ms
  user: 'GN_USER',
  session: 'GN_SESSION_ID', // changes on every sign-in; part of the cache key
  epoch: 'GN_CACHE_EPOCH', // bumped by "Refresh all formulas"
};
var GN_EXPIRY_SKEW_MS_ = 5 * 60 * 1000;
var GN_LOCK_WAIT_MS_ = 10 * 1000;
var GN_MSG_SIGN_IN_ = 'Not signed in to Glassnode. Open Extensions > Glassnode > Open and sign in.';
var GN_MSG_EXPIRED_ = 'Glassnode session expired. Open Extensions > Glassnode > Open and sign in again.';

function gnStore_() {
  return PropertiesService.getDocumentProperties();
}

function gnReadSession_() {
  var p = gnStore_().getProperties();
  return {
    accessToken: p[GN_PROP_.access] || '',
    refreshToken: p[GN_PROP_.refresh] || '',
    expiresAt: Number(p[GN_PROP_.expiresAt]) || 0,
    user: p[GN_PROP_.user] || '',
    sessionId: p[GN_PROP_.session] || '',
    epoch: p[GN_PROP_.epoch] || '0',
  };
}

function gnAccessValid_(s) {
  // Every sign-in stores a session ID; an access token without one is left over.
  return !!s.sessionId && !!s.accessToken && s.expiresAt - GN_EXPIRY_SKEW_MS_ > Date.now();
}

/**
 * Run fn(locked) under the document lock. Every write to the session happens
 * with the lock held; fn still runs without it, and must then not write.
 */
function gnWithSessionLock_(fn) {
  var lock = null;
  try {
    lock = LockService.getDocumentLock();
    if (!lock.tryLock(GN_LOCK_WAIT_MS_)) lock = null;
  } catch (e) {
    lock = null;
  }
  try {
    return fn(!!lock);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function gnClearSession_() {
  var store = gnStore_();
  [GN_PROP_.access, GN_PROP_.refresh, GN_PROP_.expiresAt, GN_PROP_.user, GN_PROP_.session].forEach(function (k) {
    store.deleteProperty(k);
  });
}

/** POST a form to the Auth0 tenant. Returns {code, body}. */
function gnAuthPost_(path, form) {
  var resp = UrlFetchApp.fetch(GN_CONFIG_.authDomain + path, {
    method: 'post',
    payload: form,
    muteHttpExceptions: true,
  });
  var body = {};
  try {
    body = JSON.parse(resp.getContentText()) || {};
  } catch (e) {
    body = {error: 'invalid_response', error_description: 'HTTP ' + resp.getResponseCode()};
  }
  return {code: resp.getResponseCode(), body: body};
}

/**
 * Return a usable access token, refreshing it when it is close to expiry.
 * Safe to call from custom functions.
 *
 * @param {string=} rejectedToken An access token the API just rejected with
 *     401. Forces a refresh unless another execution already replaced it.
 */
function gnGetAccessToken_(rejectedToken) {
  var usable = function (s) {
    return gnAccessValid_(s) && s.accessToken !== rejectedToken;
  };
  var s = gnReadSession_();
  if (!s.accessToken && !s.refreshToken) throw new Error(GN_MSG_SIGN_IN_);
  if (usable(s)) return s.accessToken;
  if (!s.refreshToken) throw new Error(GN_MSG_EXPIRED_);

  // Many cells can recalculate at once. The lock keeps them from all
  // refreshing; whoever gets it first refreshes and the rest re-read. Refresh
  // tokens are non-rotating, so a call that can't get the lock still refreshes,
  // but only uses the new token and leaves the session to the lock holder.
  return gnWithSessionLock_(function (locked) {
    s = gnReadSession_();
    if (usable(s)) return s.accessToken;
    if (!s.refreshToken) throw new Error(s.accessToken ? GN_MSG_EXPIRED_ : GN_MSG_SIGN_IN_);

    var r = gnAuthPost_('/oauth/token', {
      grant_type: 'refresh_token',
      client_id: GN_CONFIG_.clientId,
      refresh_token: s.refreshToken,
    });
    if (!locked) {
      if (r.code === 200 && r.body.access_token) return r.body.access_token;
      throw new Error(r.body.error === 'invalid_grant' ? GN_MSG_EXPIRED_ : 'Could not refresh the Glassnode session. Try again shortly.');
    }
    // The session changed meanwhile (only possible if a writer skipped the lock): it wins.
    var now = gnReadSession_();
    if (!gnSameSession_(s, now)) {
      if (usable(now)) return now.accessToken;
      throw new Error(now.refreshToken ? GN_MSG_EXPIRED_ : GN_MSG_SIGN_IN_);
    }
    if (r.code === 200 && r.body.access_token) {
      gnSaveTokens_(r.body, false);
      return r.body.access_token;
    }
    if (r.body.error === 'invalid_grant') {
      // The refresh token was revoked or hit its inactivity limit.
      gnClearSession_();
      throw new Error(GN_MSG_EXPIRED_);
    }
    throw new Error(
      'Could not refresh the Glassnode session (' + (r.body.error || 'HTTP ' + r.code) + '). Try again shortly.'
    );
  });
}

/** Persist a token response. On a fresh login also start a new cache session. */
function gnSaveTokens_(tokens, isLogin) {
  var props = {};
  props[GN_PROP_.access] = tokens.access_token;
  props[GN_PROP_.expiresAt] = String(Date.now() + (Number(tokens.expires_in) || 0) * 1000);
  // Auth0 only returns a refresh token when it issues a new one.
  if (tokens.refresh_token) props[GN_PROP_.refresh] = tokens.refresh_token;
  if (isLogin) {
    var claims = gnJwtPayload_(tokens.id_token, function (part) {
      return Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString();
    });
    props[GN_PROP_.user] = claims.email || claims.name || 'Glassnode account';
    props[GN_PROP_.session] = Utilities.getUuid();
  }
  gnStore_().setProperties(props, false);
}

function gnDeviceCacheKey_() {
  return 'gn_device_' + SpreadsheetApp.getActive().getId();
}

// ---------------------------------------------------------------------------
// Sidebar API. These are called through google.script.run and return status
// only, never tokens or the device code.
// ---------------------------------------------------------------------------

/** Current sign-in state for the sidebar. */
function gnAuthStatus() {
  var s = gnReadSession_();
  return {signedIn: !!(s.refreshToken || gnAccessValid_(s)), user: s.user};
}

/** Start the device flow. Returns the code and link to show to the user. */
function gnAuthStart() {
  var r = gnAuthPost_('/oauth/device/code', {
    client_id: GN_CONFIG_.clientId,
    audience: GN_CONFIG_.audience,
    scope: GN_CONFIG_.scope,
  });
  if (r.code !== 200 || !r.body.device_code) {
    throw new Error('Could not start sign-in: ' + (r.body.error_description || r.body.error || 'HTTP ' + r.code));
  }
  var ttl = Math.min(Number(r.body.expires_in) || 900, 21600);
  // The device code stays server-side, in a cache private to this Google user.
  CacheService.getUserCache().put(gnDeviceCacheKey_(), r.body.device_code, ttl);
  return {
    userCode: r.body.user_code,
    verificationUrl: r.body.verification_uri_complete,
    interval: Number(r.body.interval) || 5,
    expiresIn: ttl,
  };
}

/** Poll once for completion of the device flow. */
function gnAuthPoll() {
  var cache = CacheService.getUserCache();
  var deviceCode = cache.get(gnDeviceCacheKey_());
  if (!deviceCode) return {status: 'expired'};
  var r = gnAuthPost_('/oauth/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: GN_CONFIG_.clientId,
    device_code: deviceCode,
  });
  if (r.code === 200 && r.body.access_token) {
    if (!r.body.refresh_token) {
      return {status: 'error', message: 'Sign-in did not return a long-lived session. Contact Glassnode support.'};
    }
    cache.remove(gnDeviceCacheKey_());
    var tokens = r.body;
    var saved = gnWithSessionLock_(function (locked) {
      if (locked) gnSaveTokens_(tokens, true);
      return locked;
    });
    if (!saved) return {status: 'error', message: 'Glassnode is busy in this spreadsheet. Sign in again.'};
    return {status: 'ok', user: gnReadSession_().user};
  }
  switch (r.body.error) {
    case 'authorization_pending':
      return {status: 'pending'};
    case 'slow_down':
      return {status: 'pending', slowDown: true};
    case 'expired_token':
      cache.remove(gnDeviceCacheKey_());
      return {status: 'expired'};
    case 'access_denied':
      cache.remove(gnDeviceCacheKey_());
      return {status: 'denied'};
    default:
      return {status: 'error', message: r.body.error_description || r.body.error || 'HTTP ' + r.code};
  }
}

/** Sign out: clear the sheet's session, then revoke its refresh token (best effort). */
function gnAuthSignOut() {
  // Clear under the lock first, then revoke the token that was cleared, so a
  // sign-in that lands during the revoke request is kept.
  var refreshToken = gnWithSessionLock_(function (locked) {
    if (!locked) throw new Error('Glassnode is busy in this spreadsheet. Try signing out again.');
    var token = gnReadSession_().refreshToken;
    gnClearSession_();
    return token;
  });
  if (refreshToken) {
    try {
      gnAuthPost_('/oauth/revoke', {client_id: GN_CONFIG_.clientId, token: refreshToken});
    } catch (e) {
      // The local sign-out already happened.
    }
  }
  return gnAuthStatus();
}
