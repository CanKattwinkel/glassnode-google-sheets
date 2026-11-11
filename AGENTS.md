# `glassnode-google-sheets`: agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: setup, commands, commit format and
guidelines all live there. Before opening a PR, run the checks in its "Build and test"
section. Never approve or merge your own PR: a code owner approves and merges it.

The file layout and code conventions are in
[README.md → Development](README.md#development).

## Don't

- Run `clasp push`, `clasp deploy` or `clasp create-script`. `clasp push` overwrites the
  live Apps Script project named in `.clasp.json`; `clasp create-script` overwrites
  `src/appsscript.json`. A human does both.
- Add an OAuth scope or a host to `src/appsscript.json`, or change the sign-in flow or
  session storage in `src/Auth.js`, without a discussion first.
- Log, return or put into an error message a token, device code or anything else from the
  session. Functions that touch a token end in `_`; functions the sidebar calls return
  status only.
- Add a runtime dependency: Apps Script runs the files in `src/` as they are, with no
  bundler.
