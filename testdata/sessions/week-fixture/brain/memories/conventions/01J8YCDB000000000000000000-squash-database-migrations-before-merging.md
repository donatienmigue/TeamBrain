---
id: 01J8YCDB000000000000000000
class: convention
scope: team
status: active
priority: advisory
title: "Squash database migrations before merging"
created: 2026-05-01
supersedes: []
tags:
  - database
  - migrations
ttl_days: null
---

Squash all database migration files into a single migration before merging a
feature branch. Multiple migration files from one branch cause ordering
conflicts on main when two branches add migrations in parallel.
