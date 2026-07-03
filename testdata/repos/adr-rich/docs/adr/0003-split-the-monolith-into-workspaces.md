# 3. Split the monolith into pnpm workspaces

Date: 2026-02-09

## Status

Accepted

## Context

The application began as a single package with a single build. Over two
years it grew to roughly two hundred thousand lines, and the build now
takes eleven minutes on CI even with caching. Teams block each other on
merge queues because every change, however local, triggers the full
pipeline. Ownership is unclear: the dependency graph inside the package
is invisible, so a change to a shared utility routinely breaks a feature
team three directories away. New hires report that the hardest part of
onboarding is discovering which parts of the tree are safe to touch.
We evaluated three options: keep the monolith and invest in build
caching, extract services behind network boundaries, or restructure the
repository into explicit workspace packages with enforced dependency
direction. Network extraction was rejected for now because the domains
share a database and the operational cost of distributed transactions
would land before any benefit. Better caching alone does not fix
ownership or the invisible dependency graph.

## Decision

We restructure the repository into pnpm workspace packages along domain
lines: catalog, ordering, fulfillment, identity, and a small set of
shared foundation packages (config, logging, design tokens). Each
package declares its dependencies explicitly in its manifest, and a lint
rule forbids importing another package's internals — only published
entry points. Feature packages may depend on foundation packages, never
on each other; cross-domain interaction goes through the event bus or
the API layer. Each package owns its build, its tests, and a CODEOWNERS
entry naming the responsible squad. CI builds only the packages affected
by a change, computed from the workspace graph, with a weekly full
rebuild as a safety net.

## Consequences

Build times for a typical change drop from eleven minutes to under
three, because only the affected packages compile and test. Ownership
becomes explicit and reviewable: the manifest diff shows every new
dependency edge, and the forbidden-import rule turns architectural
erosion into a lint failure instead of a discovery during an incident.
The cost is real: the migration touches every import path in the tree,
takes an estimated six engineer-weeks, and during the transition the
team maintains a compatibility shim so unmigrated code keeps building.
Some duplication is accepted deliberately — small utilities may be
copied into two packages rather than promoted to a foundation package
prematurely, because a wrong shared abstraction costs more than twenty
duplicated lines. We revisit the package boundaries after two quarters
against the metric that at least eighty percent of pull requests touch
exactly one feature package.
