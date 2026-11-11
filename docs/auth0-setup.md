# Auth0 setup for an environment

The add-on signs users in with the OAuth 2.0 **device authorization flow**. Each
environment needs one Auth0 application for it. The dev tenant already has one;
this page describes how to create the same thing in another tenant, and was
written for production.

| | Dev | Production |
|---|---|---|
| Auth0 tenant | `glassnode-dev.eu.auth0.com` | `glassnode.eu.auth0.com` |
| Auth domain | `auth.glassnode.tech` | `auth.glassnode.com` |
| API identifier (audience) | `https://api.glassnode.tech` | `https://api.glassnode.com` |
| Application | "Glassnode Google Sheets" (`BkaKaI7ptCrahjfrmybSfBcpmXrNurGl`) | to be created |

## What is already in place in production

Checked read-only on 2026-11-11; nothing here needs changing.

- The API `https://api.glassnode.com` has **Allow Offline Access** on, so it
  issues refresh tokens. Access tokens last 7 days.
- `auth.glassnode.com` advertises the device authorization endpoint.
- No production application has the Device Code grant yet, so this will be the
  first use of the device flow on the production tenant.
- The tenant has no default audience. The add-on always sends `audience`, so
  that is fine.

## 1. Create the application

Use a dedicated application rather than reusing the CLI's: it gets its own
grant types and refresh-token policy, and can be revoked on its own.

### With the Auth0 CLI

```sh
auth0 api post clients --tenant glassnode.eu.auth0.com --data '{
  "name": "Glassnode Google Sheets",
  "description": "Google Sheets add-on. Device authorization flow; tokens stored per spreadsheet.",
  "app_type": "native",
  "is_first_party": true,
  "oidc_conformant": true,
  "token_endpoint_auth_method": "none",
  "logo_uri": "https://glassnode.com/favicon.png",
  "grant_types": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
  "callbacks": [],
  "jwt_configuration": {"alg": "RS256"},
  "refresh_token": {
    "rotation_type": "non-rotating",
    "expiration_type": "expiring",
    "infinite_token_lifetime": true,
    "token_lifetime": 31557600,
    "infinite_idle_token_lifetime": false,
    "idle_token_lifetime": 7776000,
    "leeway": 0
  }
}'
```

This is the request that created the dev application, with only the tenant
changed. Always pass `--tenant`; the CLI otherwise acts on whichever tenant is
active. Note the `client_id` in the response.

### With the dashboard

Applications → Create Application → **Native**, named "Glassnode Google
Sheets". Then in its settings:

| Setting | Value | Why |
|---|---|---|
| Credentials → Authentication Method | None | Public client. The add-on's source is visible to users, so it cannot hold a secret. |
| Allowed Callback URLs | empty | The device flow has no redirect. |
| Advanced → OAuth → OIDC Conformant | on | |
| Advanced → Grant Types | **Device Code** and **Refresh Token** only | Nothing else is used. |
| Refresh Token Rotation | off | Many cells refresh concurrently. With rotation and reuse detection, two refreshes at once revoke the session. |
| Refresh Token Expiration → Absolute | off (no absolute lifetime) | A sheet in regular use should never ask for sign-in again. |
| Refresh Token Expiration → Inactivity | on, 7776000 seconds (90 days) | Abandoned sheets lose their session. |

In the Management API this combination is `expiration_type: "expiring"` with
`infinite_token_lifetime: true`. `expiration_type: "non-expiring"` is rejected
when an inactivity lifetime is set.

## 2. Enable the login connections

The application needs the same connections as the Glassnode CLI application:
`google-oauth2` and `Username-Password-Authentication`. On dev, Auth0 enabled
both automatically when the application was created. Check under the
application's **Connections** tab, or:

```sh
auth0 api get "clients/<CLIENT_ID>/connections" --tenant glassnode.eu.auth0.com
```

That command prints each connection's full settings, **including the Google
connection's client secret**. Pipe it through a filter or use the dashboard.

## 3. Check anything keyed on the client ID

These could not be checked from the outside and need someone who knows the
production setup:

- **API authorization.** On dev, `api.glassnode.tech` accepted tokens from the
  new application without any backend change. If production validates the
  token's `azp` claim against an allow-list, add the new client ID.
- **Auth0 Actions.** Any login Action that branches on the client ID.
- **Device activation page.** Open `https://auth.glassnode.com/activate` and
  check that it carries Glassnode branding. It is the first page a user sees.

## 4. Add the client ID to the add-on

Set `clientId` in the `prod` block of `src/Config.js`.

## 5. Verify the chain before testing in a sheet

```sh
AUTH=https://auth.glassnode.com
API=https://api.glassnode.com
CLIENT_ID=<CLIENT_ID>

# 1. Start the flow. Open verification_uri_complete and approve.
curl -s -X POST $AUTH/oauth/device/code \
  -d client_id=$CLIENT_ID -d audience=$API \
  --data-urlencode "scope=openid profile email offline_access"

# 2. Exchange the device code. Expect access_token, refresh_token, expires_in.
curl -s -X POST $AUTH/oauth/token \
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
  -d client_id=$CLIENT_ID -d device_code=<DEVICE_CODE>

# 3. Call the API. Expect 200.
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "$API/v1/metadata/assets?source=sheets-add-on"

# 4. Refresh. Expect a new access_token and no new refresh_token.
curl -s -X POST $AUTH/oauth/token \
  -d grant_type=refresh_token -d client_id=$CLIENT_ID -d refresh_token=<REFRESH_TOKEN>
```

A 401 or 403 in step 3 means the API does not accept the new application yet
(see step 3 of this page). A missing `refresh_token` in step 2 means the
Refresh Token grant or the API's offline access is off.

## Reference: the dev application

Created on 2026-11-10 with the request above against
`glassnode-dev.eu.auth0.com`, then verified with the four calls in step 5: the
dev API returned 200 for the asset list and a metric, the refresh succeeded
and returned no new refresh token, and an invalid token got 401.
