---
id: 01J8YC12B3C4D5E6F7G8H9J0K1
class: convention
scope: team
status: active
priority: required
title: "Squash-merge database migrations"
created: 2026-06-21
supersedes: []
tags:
  - database
ttl_days: null
---

Squash-merge migration PRs so each release carries one migration commit.
If a deploy fails, revert the previous migration before applying a new
one. Never edit a migration that has already shipped to production.
