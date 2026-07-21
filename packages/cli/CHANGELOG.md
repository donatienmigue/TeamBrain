# @teambrain/cli

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
