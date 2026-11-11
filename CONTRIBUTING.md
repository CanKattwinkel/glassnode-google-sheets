# Contributing

## Contents

- [Build and test](#build-and-test)
- [Running it in a spreadsheet](#running-it-in-a-spreadsheet)
- [Commit messages](#commit-messages)
- [Making a change](#making-a-change)
- [Releasing](#releasing)

## Build and test

Requirements: Node.js 18+. There is nothing to install.

```bash
npm run lint   # syntax check of every file in src/ and test/
npm test       # unit tests for src/Lib.js and the session handling in src/Auth.js
```

The file layout and code conventions are in
[README.md → Development](README.md#development).

## Running it in a spreadsheet

You need [`clasp`](https://github.com/google/clasp), logged in with a Google account that
can edit the Apps Script project.

```bash
clasp push     # upload src/ to the Apps Script project in .clasp.json
```

`.clasp.json` names the Apps Script project to push to. It isn't committed: copy
`.clasp.json.example` to `.clasp.json` and fill in the project's script ID and its
spreadsheet's ID (ask a code owner for the shared development project). To work on your own
copy instead, run `clasp create-script --type sheets --rootDir src`, which writes
`.clasp.json`, and restore `src/appsscript.json` afterwards, because `clasp` overwrites it.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`<type>(<optional scope>): <summary>`, e.g. `fix(api): wait for the rate-limit reset`. Types:
`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `chore`. A breaking change adds `!`
(`feat!: …`) or a `BREAKING CHANGE:` footer. The version bump: breaking major, `feat` minor,
any other change to the add-on patch. The PR title follows the same format.

## Making a change

1. Open a PR against `main`. CI must pass.
2. Bump the version in `package.json` following semantic versioning.
3. Add an entry for that version at the top of [CHANGELOG.md](CHANGELOG.md).
4. A code owner approves and merges.

Steps 2 and 3 apply to changes to the add-on itself (anything in `src/`); skip them for
docs-, CI- and tooling-only changes.

## Releasing

1. Merge release PRs one at a time.
2. A code owner with the Maintain role tags `v<version>` on `main` and creates the GitHub
   Release from the `CHANGELOG.md` section.

The add-on is not published to the Google Workspace Marketplace, so a release is the tag
and the GitHub Release.
