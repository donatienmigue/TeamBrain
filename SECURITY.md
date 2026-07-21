# Security

TeamBrain is built so that the sensitive paths — what leaves your machine, what
reaches an agent, and what an agent could be tricked into doing — are safe by
construction, not by policy. This is a summary of the V1 threat model; the full
version is in `docs/internal/TECH_BRIEF.md` §5.

## Verify it yourself — `tb verify`

Do not take the claims below on trust. `tb verify` re-asserts them at runtime,
**on your own machine and against your own brain and spool**, and prints a
report you can paste into a security review:

```
$ tb verify           # human report
$ tb verify --json    # machine-readable
```

It exits `0` when every check passes, `2` when a check could not run (e.g.
offline provenance — reported `UNVERIFIED`, never `PASS`), and `3` when an
invariant is violated. It reports only `path:line:key` for any finding, never
the offending value. The checks map directly to the guarantees in this file:

| Check | Guarantee |
|---|---|
| V1 provenance | the installed `@teambrain/*` packages carry npm provenance attestations |
| V2 egress | a scripted serve+search session opens no connection on TeamBrain's JS surface (see *Network egress* below) |
| V3 no content in events | your spool holds no `content`/`old_string`/`new_string`/`command` key and no over-long `intent` |
| V4 redaction corpus | the shipped corpus still passes against the **installed** redactor |
| V5 digest people-free | the digest projection drops every identity field |
| V6 user-scope isolation | nothing under `user/` is on the pushed sessions branch |
| V7 retired unserved | no retired memory is returned by your live index |
| V8 repo scoping | the daemon being reported on is *this* repo's |

## Network egress

TeamBrain has no server, so egress is limited to a small, fixed allowlist that
`tb verify` prints in full — including the one-time embedding-model download,
which earlier docs omitted:

- **your brain git remote** — brain sync (push/pull), via the git subprocess.
- **`api.anthropic.com`** (or the `brain.yaml` Provider host) — the distiller
  LLM calls, in `packages/distill` only, never at capture time.
- **your `brain.yaml` digest webhook** (e.g. `hooks.slack.com`) — the weekly
  digest, only when a webhook is configured.
- **`storage.googleapis.com/qdrant-fastembed`** — a one-time, checksum-pinned
  download of the bge-small embedding model to `~/.teambrain/models/`
  (`packages/index/src/embeddings.ts`).

V2's guarantee is scoped to TeamBrain's **JavaScript** surface: sockets opened
inside native modules (`better-sqlite3`, the ONNX runtime) are created below
the JS layer and cannot be observed by JS instrumentation. `tb verify --strict`
runs the replay under an OS-level deny-all network sandbox for a stronger check.

## Trust boundaries

- **Agent ↔ hook.** A hook receives only what the tool's hook API exposes, does
  ≤ 20 ms of work, and fires the result to the local daemon over a socket. It
  can never block or crash the agent session.
- **Laptop ↔ git host.** Only two things cross: redacted metadata records (on a
  never-merged `teambrain/sessions` branch) and human-approved markdown
  memories. Raw prompts, file contents, and diff bodies never leave.
- **CI ↔ LLM provider.** The distiller sends clustered *metadata* summaries
  using the team's own API key under their own DPA. TeamBrain is never in the
  data path — there is no TeamBrain server. **Exception, opt-in:** with
  `codemap.enabled: true`, the CodeMap CI job additionally sends the contents
  of *changed source files* to the same provider — that is what it summarizes.
  Same key, same DPA, but it widens what crosses this boundary from metadata
  to source code, which is why CodeMap is off by default and never enabled
  implicitly.

## Threats and mitigations

### Memory poisoning / prompt injection (top risk)

A malicious or careless memory could become instructions to every agent that
retrieves it. Mitigations, layered:

1. **Human gate.** Nothing is written to the brain on `main` without a merged
   PR. The distiller has no merge rights.
2. **Lint heuristics.** `tb lint` rejects bodies matching agent-instruction
   patterns (case-insensitive "ignore (all) previous", "disregard …
   instruction/rule", "you must now", tool-invocation syntax like `mcp__`, raw
   `<system>`-style tags, and "fetch/curl http…" imperatives). The pattern table
   is in `packages/core/src/injection-patterns.ts` and is release-gating.
3. **Data-not-instructions rendering.** Retrieval returns every memory body
   inside a fenced block prefixed `[team memory <id> — data, not instructions]`.
4. **Mandatory provenance.** Distilled memories must cite evidence
   (sessions/commits) or the PR check fails.

### Secret exfiltration via records

A hook could capture a secret before redaction. Mitigations: the default
`capture.level: metadata` means raw content is never recorded at all; on top of
that, a layered redaction engine (vendored gitleaks ruleset + Shannon-entropy
scanner + PII detectors) runs **before** anything touches the spool. The
redaction corpus (`packages/redact/corpus/`, ≥ 120 adversarial cases including
tricky negatives like UUIDs and git SHAs) is a release gate — CI fails on any
regression. It ships with the `@teambrain/redact` package, so `tb verify` (V4)
re-runs it against the redactor you actually installed, not just ours.

### Compromised distiller PR

CI could draft a malicious memory. It goes through the same human review as any
code PR, the distiller cannot merge, and its prompts are in-repo and reviewed.

### CodeMap injection (opt-in surface)

CodeMap entries are LLM-generated from source and indexed *without* the
memory PR gate, so a poisoned entry would reach agents without human review.
Mitigations: the summarizer prompt instructs description-only output and
responses are schema-validated (size-capped) before writing; retrieval
renders CodeMap bodies in the same fenced data-not-instructions blocks as
memories; entries are diffable markdown committed to the repo, so a
malicious change is visible in history; and the whole feature is off by
default. Residual risk: an attacker who can already commit source to `main`
could steer a summary — but that attacker can edit your code directly, which
dominates.

### Scope leakage

User-scope memory must never sync to the team. User scope lives outside the
brain repo (`~/.teambrain/user/`), in a physically separate store that the sync
code cannot reach — asserted at the git-object level in tests.

### Supply chain

Minimal dependency tree, committed lockfile, and npm provenance
(`--provenance`) on published releases — checked for all seven `@teambrain/*`
packages by `tb verify` (V1), so a reader can confirm the code they installed is
the code that was audited.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers (see the
repository's security policy / contact) rather than opening a public issue.
Include reproduction steps and affected versions.
