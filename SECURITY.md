# Security policy

SoMa Skate is a static browser game: the built site (`./skate build`) is plain files with no server code, no accounts and no stored personal data. Settings, high scores and ghosts stay in the player's own browser storage. The dev server (`npm run dev`) and the `./skate` harness are development tools meant for `127.0.0.1` only; don't expose them to a network.

## Supported versions

Fixes go into `main`. There are no maintained release branches.

## Reporting a vulnerability

Please report privately through GitHub: open a report at https://github.com/Pyanov/soma-skate/security/advisories/new. Don't open a public issue for a vulnerability.

Include what is affected (the built site, the dev server, the harness, a tool in `tools/`), how to reproduce it, and what an attacker could do with it. You should get an answer within two weeks. Once a fix is in `main`, the advisory is published with credit to you unless you ask otherwise.

Things that are in scope, for example:

- the built site running script it should not (through data files, URL parameters, or a replay or snapshot file someone shares);
- `./skate world fetch` unpacking files outside `assets/park/` or skipping its hash check;
- a dev-server endpoint writing outside the repo's `inbox/`, `out/` or `data/`.

The optional art and voice tools in `tools/` read an OpenAI key from `OPENAI_API_KEY`; never commit a key or put one in a file in the repo.
