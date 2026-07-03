# 1. Use Postgres for transactional data

Date: 2025-11-04

## Status

Accepted

## Context

Order and inventory writes need multi-row transactions and strong
constraints. The prototype used a document store and we spent more time
writing application-level integrity checks than features.

## Decision

All transactional data lives in a single Postgres cluster. Services get
their own schemas, not their own databases, so cross-domain reports can
join without an ETL hop. JSONB columns are allowed for genuinely
schemaless payloads but never for fields we filter or join on.

## Consequences

Migrations become a shared concern: one migration pipeline, reviewed by
the data guild. Read replicas cover reporting load. Teams give up the
freedom to pick their own datastore for transactional state.
