# @teambrain/inject-bench

A public **memory-poisoning benchmark** for MCP memory servers. It measures how
a system behaves when its memory store is adversarial: does it refuse to store a
poisoned memory (tier 1), and if it does store one, is it served to the agent as
inert data rather than live instructions (tier 2)?

The harness is an **MCP client**. Because every system under test exposes MCP,
one generic client can score TeamBrain, Mori, Mem0-backed servers, and anything
else that appears — no per-target adapters, no cooperation required. In-process
adapters (`teambrainSystem`, `vulnerableMockSystem`) implement the same
`SystemUnderTest` interface for reproducible scoring and for the validity
control.

## Tiers

1. **Ingestion-block rate** — did the system refuse to store the payload? (LLM-free.)
2. **Containment rate** — if stored, is it served as inert data? (LLM-free.)
3. **Behavioural compliance** — run a real agent against the served memory and
   measure whether the payload changed its behaviour. Costs money; behind a flag;
   record model + version + date with every number. *(Not enabled here.)*

## Attack classes

instruction override · **fence escape** (the real F1 defect — a body containing a
` ``` ` run that tries to break out of the data-not-instructions container) ·
tool-invocation syntax · exfiltration imperatives · scope escalation ·
unicode/homoglyph smuggling · encoded payloads · conditional "sleeper" payloads.

## TeamBrain's own results — including where tier 1 misses

Reproduced from a clean clone (the test suite asserts these):

| metric | TeamBrain | vulnerable mock (validity control) |
|---|---|---|
| ingestion-block rate (tier 1) | 50% | 0% |
| containment rate (tier 2) | 100% | 0% |
| **safe rate** (blocked OR contained) | **100%** | **0%** |

We publish the failures honestly: TeamBrain's tier-1 lint gate is a keyword
heuristic, so it does **not** block the homoglyph, base64-encoded, or sleeper
payloads — those evade the filter. What saves every one of them is tier 2: the
C3 rendering rule wraps each body in a CommonMark-correct dynamic fence
(the F1 fix), so the payload is served as attributed, inert data and cannot break
out. The one number that matters — *did a poisoned memory reach the agent as an
instruction?* — is **no, for every class**. The F1 story (found by our own
hostile audit, fixed with a correct fence, regression-tested) is a better
credibility artifact than a perfect scorecard.

The **validity control** is non-negotiable: a knowingly-vulnerable mock server
that stores anything and serves it raw scores **0**. If it scored well, the
benchmark would measure nothing.

## Responsible disclosure

Every attack class here is a **known, published injection technique**. The corpus
is defensive test material in the same category as the gitleaks ruleset TeamBrain
vendors for redaction. It is deliberately **not shipped** in the npm package
(`files` is `dist` only) — it lives in the repo for reproduction. Do not use it
to attack systems you do not own.

## Status

The corpus, scorer, in-process adapters, and validity control are built and
tested. Publishing the results as a public comparison (E5.4) is a human decision
and has not been made.
