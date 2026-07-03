---
id: 01J8YD67G8H9J0K1M2N3P4Q5R6
class: decision
scope: team
status: active
priority: advisory
title: "Document every service boundary"
created: 2026-06-30
supersedes: []
tags:
  - architecture
ttl_days: null
---

Document every service boundary in the platform so that new team
members can trace a request end to end without reading source code.
Each boundary document names the owning team, the transport in use, the
authentication scheme, the retry policy, and the paging escalation path
for the service on both sides of the boundary. Keep the documents next
to the code they describe and review them in the same pull request as
any change that moves the boundary.

The payments boundary sits between the checkout service and the ledger
service. Checkout emits a signed intent record onto the payments queue
and the ledger consumes it within five seconds under normal load. The
ledger never calls back into checkout; reconciliation runs as a nightly
batch that compares intent records against posted entries and raises a
ticket for every mismatch it finds. The queue retains records for seven
days so a stalled consumer can catch up without data loss.

The identity boundary sits between the gateway and every internal
service. The gateway terminates external sessions, exchanges them for
short-lived internal tokens, and forwards the token in a header that
internal services validate against the shared public key set. Internal
services never see external credentials and must not log the token
header. Key rotation happens quarterly and both the old and new keys
stay valid for one overlapping week so that rolling deploys never
strand a token that was minted moments before the rotation.

The search boundary sits between the catalog service and the indexer.
The catalog publishes change events with the full document body so the
indexer never reads the catalog database directly. When the indexer
falls behind by more than ten minutes it switches to a bulk snapshot
endpoint, replays the snapshot, and then resumes the event stream from
the recorded high-water mark. Operators can trigger the same snapshot
replay manually when a mapping change requires a full reindex of the
corpus.

The notification boundary sits between every product service and the
messaging hub. Product services submit a template identifier and a
payload; the hub owns rendering, provider selection, rate limiting, and
suppression lists. No product service may call an email or SMS provider
directly, because the hub is the single place where unsubscribe state
is enforced. The hub acknowledges submissions synchronously and
delivers asynchronously, and it exposes a delivery status endpoint that
product teams poll when they need read receipts for compliance work.
