---
id: 01J8YC23C4D5E6F7G8H9J0K1M2
class: learning
scope: team
status: active
priority: advisory
title: "Legacy webhook handlers skip the naming rule"
created: 2026-06-24
evidence:
  sessions:
    - s_01J8YC0A1B2C3D4E5F6G7H8J9K
  commits:
    - 9f8e7d6
supersedes: []
tags:
  - webhooks
ttl_days: 180
---

Handlers written before 2025 disregarded the module naming rule, so
their imports do not match their file names. Grep for the handler id,
not the module name, when tracing a webhook bug in `services/hooks/`.
