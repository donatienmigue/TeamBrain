---
id: 01J8YB1KM2N3P4Q5R6S7T8V9W0
class: convention
scope: org
status: active
priority: advisory
title: "Prefix feature branches with ticket ids"
created: 2026-05-20
supersedes: []
tags:
  - git
  - workflow
ttl_days: null
---

Name feature branches as TEAM-1234-short-description so CI can link builds
back to the tracker. Branches without a ticket prefix skip the automated
changelog and must be summarized by hand at release time.
