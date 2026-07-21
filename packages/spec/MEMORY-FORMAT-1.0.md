# MEMORY-FORMAT-1.0

An independently implementable spec for a TeamBrain memory file. `docs/internal/
CONTRACTS.md` (C1) is **upstream**: this document and the exported zod/JSON
Schema are derived from it, and any divergence is a bug in this document.

## File

Path: `memories/{decisions|conventions|map|learnings}/<ULID>-<slug>.md`.
Retirement moves the file to `retired/` and sets `status: retired` in the same
change. A memory is UTF-8, LF-only, and byte-exact round-trips (parse → serialize
→ identical bytes) under the canonical serializer.

## Front-matter (YAML)

| field | type | notes |
|---|---|---|
| `id` | ULID | 26 chars, Crockford base32 |
| `class` | `decision`\|`convention`\|`map`\|`learning` | |
| `scope` | `team`\|`org` | |
| `status` | `active`\|`retired` | |
| `priority` | `required`\|`advisory` | |
| `title` | string | 1–80 chars |
| `created` | ISO date | `YYYY-MM-DD`, a real calendar date |
| `evidence` | `{sessions: string[], commits: string[]}` | optional; mandatory when the proposer is the distiller |
| `supersedes` | ULID[] | |
| `tags` | string[] | |
| `ttl_days` | int \| null | |

Unknown keys are a violation (the schema is strict). Body: markdown, ≤ 400 words.

## Versioning

Additive-only within a major version. A new optional field or enum value is a
minor bump; removing or retyping a field is a major bump. Changes follow the RFC
path in `RFC.md`; the changelog is `CHANGELOG.md`.
