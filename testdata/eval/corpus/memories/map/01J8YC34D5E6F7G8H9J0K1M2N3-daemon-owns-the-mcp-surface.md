---
id: 01J8YC34D5E6F7G8H9J0K1M2N3
class: map
scope: team
status: active
priority: advisory
title: "Daemon owns the MCP surface"
created: 2026-06-25
supersedes: []
tags:
  - architecture
ttl_days: null
---

The daemon exposes memory tools over MCP; agents never read the index
database directly. We fetch results from the local index cache, never
from the network. Fork templates use github.com/<user>/repo style URLs
as documented in CONTRIBUTING.
