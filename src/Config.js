/**
 * Environment configuration. This is the only place that names hosts or Auth0
 * clients.
 *
 * Production is the default. A development deployment opts in to another
 * environment with the script property GN_ENV (Apps Script editor > Project
 * Settings > Script Properties), e.g. GN_ENV = dev. The property belongs to
 * the script project, so it applies to everyone using that deployment and
 * cannot be changed from a spreadsheet.
 *
 * The client IDs are public OAuth clients (device flow, no secret).
 */
var GN_ENVIRONMENTS_ = {
  prod: {
    authDomain: 'https://auth.glassnode.com',
    audience: 'https://api.glassnode.com',
    apiBase: 'https://api.glassnode.com',
    // TODO: client ID of the "Glassnode Google Sheets" application in the
    // production Auth0 tenant. See docs/auth0-setup.md.
    clientId: '',
  },
  dev: {
    authDomain: 'https://auth.glassnode.tech',
    audience: 'https://api.glassnode.tech',
    apiBase: 'https://api.glassnode.tech',
    clientId: 'BkaKaI7ptCrahjfrmybSfBcpmXrNurGl',
  },
};
var GN_DEFAULT_ENV_ = 'prod';
var GN_ENV_PROPERTY_ = 'GN_ENV';
var GN_SCOPE_ = 'openid profile email offline_access';
var GN_SOURCE_ = 'sheets-add-on';

var gnConfigCache_ = null;

/** The active environment's settings, plus its name as `env`. */
function gnConfig_() {
  if (gnConfigCache_) return gnConfigCache_;
  var requested = '';
  try {
    requested = PropertiesService.getScriptProperties().getProperty(GN_ENV_PROPERTY_) || '';
  } catch (e) {
    // Script properties are unavailable before the add-on is authorized.
  }
  var env = gnPickEnvironment_(requested, Object.keys(GN_ENVIRONMENTS_), GN_DEFAULT_ENV_);
  var settings = GN_ENVIRONMENTS_[env];
  gnConfigCache_ = {
    env: env,
    authDomain: settings.authDomain,
    audience: settings.audience,
    apiBase: settings.apiBase,
    clientId: settings.clientId,
    scope: GN_SCOPE_,
    source: GN_SOURCE_,
  };
  return gnConfigCache_;
}
