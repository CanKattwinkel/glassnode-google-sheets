/**
 * Glassnode API client. Private (trailing underscore) so tokens and raw
 * responses are never reachable from a cell or the sidebar.
 *
 * Three things keep the number of API requests down, because many cells
 * recalculate at the same moment:
 *   1. Responses are cached per spreadsheet session.
 *   2. Identical requests that start together are merged: the first one
 *      fetches, the others wait for its cached result.
 *   3. Rate-limit state reported by the API is shared, so once the limit is
 *      used up other cells wait for the reset instead of spending a request
 *      to find out.
 */

var GN_CACHE_MAX_CHARS_ = 90000; // CacheService rejects values over 100 KB
// A custom function must return within 30 seconds. Waiting (for a rate-limit
// reset or for an identical request) only happens while the call still fits.
var GN_WAIT_BUDGET_MS_ = 22 * 1000;
var GN_MAX_ATTEMPTS_ = 4;
var GN_FLIGHT_TTL_S_ = 30; // an abandoned in-flight marker clears itself
var GN_FLIGHT_WAIT_MS_ = 8 * 1000;
var GN_FLIGHT_POLL_MS_ = 400;

function gnCacheKey_(session, url) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    session.sessionId + '|' + session.epoch + '|' + url
  );
  return 'gn:' + Utilities.base64EncodeWebSafe(digest);
}

function gnFetchWithToken_(url, token) {
  return UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + token},
    muteHttpExceptions: true,
  });
}

function gnRateLimitMessage_(resetAtMs) {
  // A clock time stays true while the error sits in the cell; "in N seconds" would not.
  var when = '';
  if (resetAtMs > Date.now()) {
    var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    when = Utilities.formatDate(new Date(resetAtMs + 1000), tz, 'HH:mm:ss');
  }
  return (
    'Glassnode rate limit reached (429). ' +
    (when ? 'After ' + when + ' use' : 'Wait a moment, then use') +
    ' Extensions > Glassnode > Retry failed formulas.'
  );
}

/**
 * GET a Glassnode API path and return parsed JSON.
 *
 * @param {string} path Path starting with "/v1/".
 * @param {Object} params Query parameters.
 * @param {number} ttlSeconds How long an identical request is served from cache.
 */
function gnApiGet_(path, params, ttlSeconds) {
  var query = {};
  Object.keys(params || {}).forEach(function (k) {
    query[k] = params[k];
  });
  query.source = GN_CONFIG_.source;
  var url = GN_CONFIG_.apiBase + path + '?' + gnQueryString_(query);

  // Read the session before the token: if someone signs in meanwhile, this
  // response can only land under the old session's cache key, which nothing
  // reads again. Resolving the token before any cache read means signed-out
  // sheets never serve cached data.
  var session = gnReadSession_();
  var token = gnGetAccessToken_(undefined, session.sessionId);
  var started = Date.now();

  var cache = CacheService.getDocumentCache();
  var key = gnCacheKey_(session, url);
  var flightKey = key + ':f';
  var rateKey = 'gn:rl:' + session.sessionId;
  var cached = function () {
    var hit = cache.get(key);
    return hit ? JSON.parse(hit) : null;
  };

  var data = cached();
  if (data) return data;

  // An identical request is already running: wait for its result.
  if (cache.get(flightKey)) {
    while (Date.now() - started < GN_FLIGHT_WAIT_MS_) {
      Utilities.sleep(GN_FLIGHT_POLL_MS_);
      data = cached();
      if (data) return data;
      if (!cache.get(flightKey)) break; // it failed; fetch ourselves
    }
  }

  cache.put(flightKey, '1', GN_FLIGHT_TTL_S_);
  try {
    var refreshed = false;
    for (var attempt = 0; attempt < GN_MAX_ATTEMPTS_; attempt++) {
      // Shared rate-limit state: wait for the reset without spending a request.
      var blockedUntil = Number(cache.get(rateKey)) || 0;
      if (blockedUntil > Date.now()) {
        // The jitter spreads out cells that were all waiting for the same reset.
        var waitMs = blockedUntil - Date.now() + 250 + Math.floor(Math.random() * 1750);
        if (Date.now() - started + waitMs > GN_WAIT_BUDGET_MS_) throw new Error(gnRateLimitMessage_(blockedUntil));
        Utilities.sleep(waitMs);
        data = cached();
        if (data) return data;
      }

      var resp = gnFetchWithToken_(url, token);
      var code = resp.getResponseCode();
      if (code === 401 && !refreshed) {
        // Rejected before its advertised expiry: refresh once and retry.
        refreshed = true;
        token = gnGetAccessToken_(token, session.sessionId);
        continue;
      }

      var rate = gnParseRateLimit_(resp.getHeaders(), Date.now());
      if ((code === 429 || rate.remaining === 0) && rate.resetMs !== null && rate.resetMs > 0) {
        blockedUntil = Date.now() + rate.resetMs;
        cache.put(rateKey, String(blockedUntil), Math.min(21600, Math.max(1, Math.ceil(rate.resetMs / 1000))));
      }
      if (code === 429) {
        // Without a reset time from the API there is nothing sensible to wait for.
        if (rate.resetMs === null) throw new Error(gnRateLimitMessage_(0));
        continue;
      }

      var text = resp.getContentText();
      if (code !== 200) throw new Error(gnApiErrorMessage_(code, text, path));
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('Glassnode returned a response that is not JSON for ' + path + '.');
      }
      if (text.length <= GN_CACHE_MAX_CHARS_) {
        try {
          cache.put(key, text, ttlSeconds);
        } catch (e) {
          // Caching is an optimisation only.
        }
      }
      return data;
    }
    throw new Error(gnRateLimitMessage_(Number(cache.get(rateKey)) || 0));
  } finally {
    cache.remove(flightKey);
  }
}

function gnApiErrorMessage_(code, text, path) {
  var detail = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  switch (code) {
    case 400:
      return 'Glassnode rejected the request (400)' + (detail ? ': ' + detail : '.');
    case 401:
      return GN_MSG_EXPIRED_;
    case 403:
      return 'Your Glassnode plan does not include this data (403)' + (detail ? ': ' + detail : '.');
    case 404:
      return 'Not found (404): ' + path + '. Check the metric path.';
    default:
      return 'Glassnode API error (HTTP ' + code + ')' + (detail ? ': ' + detail : '.');
  }
}
