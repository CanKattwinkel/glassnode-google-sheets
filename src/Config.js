/**
 * Environment configuration. This is the only place that names hosts or the
 * Auth0 client. Currently points at the Glassnode dev environment.
 */
var GN_CONFIG_ = {
  authDomain: 'https://auth.glassnode.tech',
  audience: 'https://api.glassnode.tech',
  apiBase: 'https://api.glassnode.tech',
  clientId: 'BkaKaI7ptCrahjfrmybSfBcpmXrNurGl', // public client, no secret
  scope: 'openid profile email offline_access',
  source: 'sheets-add-on',
};
