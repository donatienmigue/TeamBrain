# @teambrain/cli

## 0.5.1

### Patch Changes

- df16c37: `tb lint <repo-root>` now resolves one level into `.teambrain/` instead of
  reporting a `[schema]` violation for the missing `brain.yaml`. A directory with
  no brain is a user error (exit 1, `no brain found`), not a lint failure (exit
  3). A brain with `memories/` but a deleted `brain.yaml` still reports the schema
  violation. Reported by an external tester (field report 001).
  - @teambrain/core@0.5.1
  - @teambrain/distill@0.5.1
  - @teambrain/hooks@0.5.1
  - @teambrain/index@0.5.1
  - @teambrain/mcp@0.5.1
  - @teambrain/redact@0.5.1

## 0.5.0

### Minor Changes

- 2ad93e7: R16.1 T7 randomized-holdout measurement for CodeMap (deterministic per-session
  control/treatment arm, single-chokepoint control-arm serving bypass,
  `codemap_arm` on session_start, digest split with bootstrap CI + measured/
  estimated labeling) and the Performance & Health Metrics suite: session-start
  injection logging (`memory_retrieved via:'context'`), context-efficiency & rot
  metrics in `tb digest` (injection weight, required-load flag, codemap
  utilization, served staleness), real latency percentiles + bloat signals in
  `tb doctor --json`, the net-efficiency composite, and the new read-only
  `tb metrics` command. All `@teambrain/*` packages version in lockstep.

### Patch Changes

- @teambrain/core@0.5.0
- @teambrain/distill@0.5.0
- @teambrain/hooks@0.5.0
- @teambrain/index@0.5.0
- @teambrain/mcp@0.5.0
- @teambrain/redact@0.5.0
