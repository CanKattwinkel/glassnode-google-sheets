/**
 * Custom functions available in cells.
 */

// Ranges that ended over a day ago rarely change and are kept for an hour;
// ranges that still receive data only briefly.
var GN_METRIC_TTL_HISTORIC_S_ = 60 * 60;
var GN_METRIC_TTL_LIVE_S_ = 5 * 60;
var GN_ASSETS_TTL_S_ = 60 * 60;
// Window fetched when only a start date is given. Long enough to contain one
// data point at every resolution up to "1month".
var GN_SINGLE_WINDOW_S_ = 32 * 86400;

/**
 * Lists the asset IDs available on Glassnode.
 *
 * @param {number} limit Optional. Maximum number of assets to return.
 * @return {string[][]} One asset ID per row.
 * @customfunction
 */
function GN_ASSETS(limit) {
  var max = null;
  if (limit !== undefined && limit !== null && limit !== '') {
    max = Number(limit);
    if (!isFinite(max) || max < 1) throw new Error('limit must be a positive number.');
  }
  var resp = gnApiGet_('/v1/metadata/assets', {}, GN_ASSETS_TTL_S_);
  if (!resp || !Array.isArray(resp.data)) throw new Error('Unexpected response format for the asset list.');
  var ids = resp.data
    .map(function (a) {
      return a && a.id;
    })
    .filter(Boolean);
  if (max !== null) ids = ids.slice(0, Math.floor(max));
  if (ids.length === 0) throw new Error('No assets available.');
  return ids.map(function (id) {
    return [id];
  });
}

/**
 * Fetches a Glassnode metric. With only a start date it returns the first data
 * point on or after that date; with an end date it returns a table.
 *
 * @param {string} asset Asset ID, e.g. "BTC".
 * @param {string} metric Metric path, e.g. "/market/price_usd_close".
 * @param {Date|string} startDate Date cell or "YYYY-MM-DD" (UTC).
 * @param {Date|string} endDate Optional. Exclusive end date. Returns a table when set.
 * @param {...string} parameters Optional. API parameters as "key=value", e.g. "i=1h", "e=binance". Use "pick=field" to select one field of a multi-field metric.
 * @return {Array<Array>} A single value, or a table with a Date column.
 * @customfunction
 */
function GN_METRIC(asset, metric, startDate, endDate) {
  asset = String(asset === undefined || asset === null ? '' : asset).trim();
  metric = String(metric === undefined || metric === null ? '' : metric).trim();
  if (!asset || !metric) throw new Error('asset and metric are required.');
  if (metric.charAt(0) !== '/') {
    throw new Error('Invalid metric path. Use API notation like /addresses/active_count.');
  }
  if (startDate === undefined || startDate === null || startDate === '') {
    throw new Error('startDate is required.');
  }

  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var formatInTz = function (d) {
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  };
  var since = gnDateToUnix_(startDate, formatInTz, 'startDate');
  var single = endDate === undefined || endDate === null || endDate === '';
  var until = single ? since + GN_SINGLE_WINDOW_S_ : gnDateToUnix_(endDate, formatInTz, 'endDate');
  if (until <= since) throw new Error('endDate must be after startDate.');

  var extra = gnParseParams_(Array.prototype.slice.call(arguments, 4));
  var params = {a: asset, i: '24h', s: String(since), u: String(until)};
  Object.keys(extra.params).forEach(function (k) {
    params[k] = extra.params[k];
  });

  var ttl = gnMetricTtl_(until, Date.now(), GN_METRIC_TTL_HISTORIC_S_, GN_METRIC_TTL_LIVE_S_);
  var rows = gnApiGet_('/v1/metrics' + metric, params, ttl);
  return gnShapeMetric_(rows, metric, single, extra.pick, function (sec) {
    return gnCellDate_(sec, tz);
  });
}

/**
 * Convert unix seconds into a Date that displays the UTC wall-clock time in a
 * sheet with the given time zone, so "2025-01-01" from the API shows as
 * 2025-01-01 whatever the spreadsheet's zone is.
 */
function gnCellDate_(sec, tz) {
  var pattern = "yyyy-MM-dd'T'HH:mm:ss";
  return Utilities.parseDate(Utilities.formatDate(new Date(sec * 1000), 'Etc/UTC', pattern), tz, pattern);
}
