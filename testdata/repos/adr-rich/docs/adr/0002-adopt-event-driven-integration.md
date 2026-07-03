# 2. Adopt event-driven integration between domains

Date: 2025-12-16

## Status

Accepted

## Context

Synchronous calls between the order, inventory, and notification domains
created deploy coupling: a slow notification provider stalled checkout.

## Decision

Domains integrate through events on a shared broker. Producers own their
event schemas and version them additively. Consumers must tolerate
unknown fields. Synchronous calls remain allowed only inside a domain
boundary or for queries with a hard latency budget.

## Consequences

Eventual consistency becomes the default; product copy must not promise
instant cross-domain effects. Every consumer needs an idempotency key
strategy, and replayability becomes a first-class operational tool.
