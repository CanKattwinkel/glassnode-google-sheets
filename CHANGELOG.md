# Changelog

All notable changes, newest first. Format: [Keep a Changelog](https://keepachangelog.com/),
versions: [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-11

### Fixed

- `GN_METRIC` accepts only plain metric paths (letters, digits, `_` and `-` between
  slashes).
- A token refresh that finishes after a sign-out or a new sign-in no longer writes over
  that newer state. Sign-in and sign-out take the same lock as the refresh.

## [0.1.0] - 2026-11-10

### Added

- `GN_ASSETS` and `GN_METRIC` custom functions.
- Sign-in with the OAuth 2.0 device authorization flow, one session per spreadsheet.
- Sidebar and menu with **Refresh all formulas** and **Retry failed formulas**.
- Response caching, merging of identical requests and rate-limit handling.
