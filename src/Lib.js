/**
 * Pure helpers with no Apps Script dependencies, so they can be unit-tested
 * in Node (see test/lib.test.js).
 */

var GN_DAY_SECONDS_ = 86400;
// Days between the Sheets serial-number epoch (1899-12-30) and 1970-01-01.
var GN_SERIAL_UNIX_OFFSET_DAYS_ = 25569;

/**
 * Convert a date argument from a cell into unix seconds at UTC midnight.
 *
 * @param {Date|string|number} value Date cell, "YYYY-MM-DD" string or serial number.
 * @param {function(Date): string} formatInSheetTz Formats a Date as yyyy-MM-dd in
 *     the spreadsheet time zone. Date cells arrive as the instant of local
 *     midnight, so the calendar day has to be read back in that zone.
 * @param {string} name Argument name, for error messages.
 * @return {number} Unix seconds.
 */
function gnDateToUnix_(value, formatInSheetTz, name) {
  var ymd = null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error(name + ' is not a valid date.');
    ymd = formatInSheetTz(value);
  } else if (typeof value === 'number') {
    if (!isFinite(value) || value < 1) throw new Error(name + ' is not a valid date.');
    return Math.floor(value - GN_SERIAL_UNIX_OFFSET_DAYS_) * GN_DAY_SECONDS_;
  } else if (typeof value === 'string') {
    ymd = value.trim();
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) throw new Error(name + ' must be a date cell or a "YYYY-MM-DD" string.');
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var check = new Date(ms);
  if (check.getUTCMonth() !== +m[2] - 1 || check.getUTCDate() !== +m[3]) {
    throw new Error(name + ' is not a valid date: ' + ymd);
  }
  return ms / 1000;
}

/**
 * Parse optional "key=value" arguments. Accepts strings and ranges (2D arrays).
 * The reserved key "pick" selects one field of an object-valued metric and is
 * not sent to the API.
 *
 * @param {Array} args Remaining function arguments.
 * @return {{params: Object, pick: ?string}}
 */
function gnParseParams_(args) {
  var flat = [];
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && v !== undefined && String(v).trim() !== '') flat.push(String(v).trim());
  })(args);
  var out = {params: {}, pick: null};
  flat.forEach(function (item) {
    var i = item.indexOf('=');
    var key = i > 0 ? item.slice(0, i).trim() : '';
    var val = i > 0 ? item.slice(i + 1).trim() : '';
    if (!key || !val) throw new Error('Invalid parameter "' + item + '". Use "key=value", e.g. "e=binance".');
    if (key === 'api_key') throw new Error('api_key is not supported. Sign in via Extensions > Glassnode.');
    if (key === 'pick') out.pick = val;
    else out.params[key] = val;
  });
  return out;
}

/** Build a query string with keys in sorted order (stable cache keys). */
function gnQueryString_(params) {
  return Object.keys(params)
    .sort()
    .map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    })
    .join('&');
}

/**
 * Shape a metric API response into cell values.
 *
 * @param {Array<{t: number, v: *}|{t: number, o: Object}>} rows API rows.
 * @param {string} metric Metric path, used for headers.
 * @param {boolean} single Return only the first data point, without headers.
 * @param {?string} pick Field to pick from object-valued metrics.
 * @param {function(number): *} toCellDate Converts unix seconds to a cell value.
 * @return {Array<Array>}
 */
function gnShapeMetric_(rows, metric, single, pick, toCellDate) {
  if (!Array.isArray(rows)) throw new Error('Unexpected response format for ' + metric + '.');
  if (rows.length === 0) throw new Error('No data available for the requested range.');
  var cell = function (v) {
    return v === null || v === undefined ? '' : v;
  };
  var first = rows[0];
  var isValue = first && Object.prototype.hasOwnProperty.call(first, 'v');
  var isObject = first && Object.prototype.hasOwnProperty.call(first, 'o');
  if (!isValue && !isObject) throw new Error('Metric ' + metric + ' has a response format that is not supported.');
  if (single) rows = rows.slice(0, 1);

  if (isValue) {
    if (pick) throw new Error('"pick" only applies to metrics that return several fields.');
    if (single) return [[cell(first.v)]];
    return [['Date', metric]].concat(
      rows.map(function (r) {
        return [toCellDate(r.t), cell(r.v)];
      })
    );
  }

  var seen = {};
  rows.forEach(function (r) {
    Object.keys(r.o || {}).forEach(function (k) {
      seen[k] = true;
    });
  });
  var keys = Object.keys(seen).sort();
  if (pick) {
    if (!seen[pick]) throw new Error('Field "' + pick + '" not found. Available: ' + keys.join(', '));
    keys = [pick];
  }
  var values = function (r) {
    return keys.map(function (k) {
      return cell((r.o || {})[k]);
    });
  };
  if (single && pick) return [values(first)];
  var header = ['Date'].concat(
    keys.map(function (k) {
      return metric + '.' + k;
    })
  );
  return [header].concat(
    rows.map(function (r) {
      return [toCellDate(r.t)].concat(values(r));
    })
  );
}

/** Decode the payload of a JWT without verifying it (display purposes only). */
function gnJwtPayload_(jwt, base64UrlDecodeToString) {
  try {
    return JSON.parse(base64UrlDecodeToString(String(jwt).split('.')[1])) || {};
  } catch (e) {
    return {};
  }
}

/**
 * How long a metric response may be cached. A range that ended more than a
 * day ago no longer changes, so it can be kept much longer than one that
 * still receives new data points.
 */
function gnMetricTtl_(untilSec, nowMs, historicTtl, liveTtl) {
  return untilSec * 1000 < nowMs - GN_DAY_SECONDS_ * 1000 ? historicTtl : liveTtl;
}

/**
 * Read the rate-limit state the API reports in its response headers. Limits
 * differ per account, so nothing here is assumed: a missing header is null.
 *
 * @param {Object} headers Response headers.
 * @param {number} nowMs Current time, epoch ms.
 * @return {{remaining: ?number, resetMs: ?number}} Requests left in the
 *     window, and milliseconds until the window resets.
 */
function gnParseRateLimit_(headers, nowMs) {
  var h = {};
  Object.keys(headers || {}).forEach(function (k) {
    h[k.toLowerCase()] = headers[k];
  });
  var num = function (v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  };
  var reset = num(h['x-rate-limit-reset']);
  if (reset === null) reset = num(h['retry-after']);
  var resetMs = null;
  if (reset !== null) {
    // Either seconds until the reset, or an absolute epoch timestamp.
    resetMs = reset > 1e9 ? Math.max(0, reset * 1000 - nowMs) : reset * 1000;
  }
  return {remaining: num(h['x-rate-limit-remaining']), resetMs: resetMs};
}

if (typeof module !== 'undefined') {
  module.exports = {
    gnDateToUnix_: gnDateToUnix_,
    gnParseParams_: gnParseParams_,
    gnQueryString_: gnQueryString_,
    gnShapeMetric_: gnShapeMetric_,
    gnJwtPayload_: gnJwtPayload_,
    gnMetricTtl_: gnMetricTtl_,
    gnParseRateLimit_: gnParseRateLimit_,
  };
}
