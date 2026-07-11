# TeamBrain memory format

A TeamBrain brain is a directory (`.teambrain/` in your repo) of markdown files
with YAML front-matter. This document is the on-disk contract; `tb lint`
enforces it. The authoritative schema lives in `docs/internal/CONTRACTS.md` (C1)
and `packages/core`.

## Layout

```
.teambrain/
  brain.yaml            # brain config (capture level, redaction level, model, state)
  memories/
    decisions/          # class: decision
    conventions/        # class: convention
    map/                # class: map
    learnings/          # class: learning
  retired/              # retired memories (status: retired), flat
  prompts/              # versioned distiller prompts
  INDEX.md              # human-readable index (generated)
  codemap/              # CodeMap (v1.1, opt-in) — machine-generated, not PR-gated
    manifest.json       # per-file sha256 manifest driving incremental updates
    files/<path>.md     # one structural summary per source file
```

A memory file is named `<ULID>-<slug>.md` and lives in the directory matching
its `class`. Retiring a memory moves the file to `retired/` and sets
`status: retired` **in the same PR** — never edited in place on `main`.

## Front-matter

```yaml
---
id: 01J8YC01A2B3C4D5E6F7G8H9J0 # ULID (26 chars, Crockford base32)
class: decision # decision | convention | map | learning
scope: team # team | org
status: active # active | retired
priority: advisory # required | advisory
title: 'Adopt pnpm workspaces for the monorepo' # ≤ 80 chars
created: 2026-05-01 # ISO date (YYYY-MM-DD)
evidence: # mandatory for distiller-proposed memories
  sessions: ['s-8f2a']
  commits: ['9c1de4a']
supersedes: [] # ULIDs this memory replaces
tags: ['build', 'monorepo']
ttl_days: null # int | null (auto-expiry)
---
Body: imperative, agent-consumable markdown prose. Hard limit 400 words.
```

| Field | Type | Notes |
|---|---|---|
| `id` | ULID | Also the filename prefix. |
| `class` | enum | Selects the directory: `decision`/`convention`/`map`/`learning`. |
| `scope` | enum | `team` (in the brain) or `org` (design-ahead for the cloud tier). |
| `status` | enum | `active`, or `retired` (must live under `retired/`). |
| `priority` | enum | `required` memories are force-included in context; `advisory` are ranked. |
| `title` | string | ≤ 80 characters. |
| `created` | ISO date | `YYYY-MM-DD`. |
| `evidence` | object | `{sessions: string[], commits: string[]}`. Mandatory when the proposer is the distiller (`tb lint --require-evidence`). |
| `supersedes` | ULID[] | Memories this one replaces (set by conflict detection). |
| `tags` | string[] | Free-form. |
| `ttl_days` | int \| null | Optional auto-expiry horizon. |

### Body rules

- **≤ 400 words** (context-budget discipline; hard `tb lint` failure).
- **Imperative, self-contained prose** — a reader with no session context should
  understand it.
- **No agent-control content.** `tb lint` rejects bodies matching
  prompt-injection heuristics (e.g. "ignore previous instructions",
  tool-invocation syntax, `<system>`-style tags, "fetch/curl http…"
  imperatives). Memories are *data, not instructions* — retrieval renders each
  body inside a fenced, attributed block that says so.

## Canonical serialization

`tb` writes memories in a canonical form with a **byte-exact** round-trip:
fields in the order above, JSON-quoted title, block-style string lists (`[]`
when empty), `---` fences, one blank line before the body, exactly one trailing
newline, and LF line endings (a `.gitattributes` in the brain enforces LF, since
the parser rejects CR). Hand-edits that keep this form round-trip losslessly.

## CodeMap entries (v1.1, opt-in)

`.teambrain/codemap/files/<repo-path>.md` holds one machine-generated
structural summary per source file, written by `tb distill --codemap`. These
are **not memories**: derived artifacts, regenerable from source at any
commit, indexed directly under `source: 'codemap'` and never PR-gated —
`tb lint` does not apply to them. The format is deliberately tiny and
byte-stable (serialize(parse(x)) === x) so incremental runs only rewrite
entries whose source actually changed:

```yaml
---
v: 1
path: "packages/core/src/ulid.ts"  # repo-relative posix path (always quoted)
hash: 3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855c # sha256 of the source bytes
updated: "2026-07-11"              # ISO date the summary was (re)generated
---

What the file does, its public entry points, and notable cross-module
dependencies — plain prose, ≤150 words.
```

The schema lives in `packages/core/src/codemap-entry.ts`. Don't hand-edit
these files: the next `tb distill --codemap` run overwrites any entry whose
source hash changed, and deletes entries for files that no longer exist.

## Validation

```sh
tb lint .teambrain                    # schema, size, placement, injection heuristics
tb lint .teambrain --require-evidence # additionally require evidence (the distiller PR check)
```

Exit codes: `0` clean · `1` user error · `3` lint/validation failure.
