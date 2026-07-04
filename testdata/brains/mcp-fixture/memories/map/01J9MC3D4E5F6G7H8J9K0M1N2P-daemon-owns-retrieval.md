---
id: 01J9MC3D4E5F6G7H8J9K0M1N2P
class: map
scope: team
status: active
priority: advisory
title: "The daemon owns retrieval; agents use MCP"
created: 2026-06-22
supersedes: []
tags:
  - architecture
  - daemon
ttl_days: null
---

The long-lived daemon watches the brain, keeps the SQLite index fresh, and
listens on a local socket. Agents never open the index database directly;
they reach memories only through the MCP tools the server exposes. Retrieval
stays entirely local — no network calls on the read path.
