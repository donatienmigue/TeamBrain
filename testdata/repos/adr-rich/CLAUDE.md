# Working notes for agents

Prefer changing one workspace package per pull request. The affected
package's own test suite must pass locally before you push; CI computes
the affected graph and will run the rest. Never import another package's
internals — go through its published entry point, the lint rule is the
source of truth. ADRs under docs/adr are binding; propose a new ADR
rather than quietly diverging from one.
