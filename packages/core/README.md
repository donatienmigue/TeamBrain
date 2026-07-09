# @teambrain/core

**The TeamBrain brain format: schemas, parsing, lint, IDs, logging.**

Everything durable in [TeamBrain](https://github.com/donatienmigue/TeamBrain)
is a file in a git repo; this package defines and validates those files.

- **Memory files** — zod schema for the YAML front-matter (`id`, `class`,
  `scope`, `status`, `priority`, `evidence`, `supersedes`, `ttl_days`, …) and a
  canonical parse/serialize pair with a byte-exact round-trip guarantee.
- **Session events** — the versioned JSONL envelope every capture event uses
  (`sid/repo/branch/tool/model` join keys on every event).
- **`brain.yaml` config**, ULID generation, slug utilities.
- **Lint** — schema, body-size limits, evidence checks, and injection
  heuristics (a table of instruction-like patterns memory bodies must not
  contain).
- **Structured logger** with 7-day rotation; `body`/`content`/`prompt` fields
  are redacted at info level and above by design.

```sh
npm install @teambrain/core
```

Most users want the CLI instead:
[`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli) (`npm i -g`,
then `tb init`).

Apache-2.0
