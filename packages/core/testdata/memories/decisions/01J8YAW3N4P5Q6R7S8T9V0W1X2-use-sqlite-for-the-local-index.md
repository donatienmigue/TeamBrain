---
id: 01J8YAW3N4P5Q6R7S8T9V0W1X2
class: decision
scope: team
status: active
priority: advisory
title: "Use SQLite for the local index"
created: 2026-06-18
supersedes: []
tags:
  - db
  - retrieval
ttl_days: null
---

Keep the retrieval index in a single SQLite file per machine. Treat it as a
rebuildable cache: never store anything in it that cannot be regenerated
from the brain repo. If the schema changes, bump the index version and let
the daemon rebuild from scratch rather than migrating in place.
