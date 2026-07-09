# @teambrain/distill

**The TeamBrain distiller: session records → proposed memories, as a pull
request.**

The governance gate. Its output is always a *proposal to humans* — it has no
merge rights and never writes to the brain.

Pipeline (run by `tb distill`, typically on a weekly CI schedule):

1. **Collect** — new records on the `teambrain/sessions` branch since the last
   watermark, plus merged-PR metadata via `gh`.
2. **Cluster** — repeated struggle signals: the same paths fought across ≥2
   sessions, repeated failing commands, `memory_search` queries with no hits,
   agent-proposed candidates.
3. **Draft** — one structured-output LLM call per cluster against a versioned
   prompt; invalid drafts are discarded, never silently "fixed".
4. **Dedup & conflict** — embedding similarity ≥0.85 drops duplicates;
   pairwise contradiction checks set `supersedes` and flag the PR.
5. **Gate & PR** — score by evidence × novelty, cap at 10 candidates, open a
   `teambrain/proposals-<date>` PR with a reviewer-friendly summary table.

**Provider-agnostic**: LLM access goes through a small `Provider` interface
(Anthropic driver + a fixture-based FakeProvider for tests); the model is
pinned in `brain.yaml`. This package is the *only* place in TeamBrain that
calls an LLM.

```sh
npm install @teambrain/distill
```

Part of [TeamBrain](https://github.com/donatienmigue/TeamBrain) — most users
want [`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli) and its
`ci-templates/`.

Apache-2.0
