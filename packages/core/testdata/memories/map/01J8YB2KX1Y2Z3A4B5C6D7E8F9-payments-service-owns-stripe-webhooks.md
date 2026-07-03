---
id: 01J8YB2KX1Y2Z3A4B5C6D7E8F9
class: map
scope: team
status: active
priority: advisory
title: "Payments service owns Stripe webhooks"
created: 2026-06-10
evidence:
  sessions:
    - s_01J8Y8Z1A2B3C4D5E6F7G8H9J0
  commits: []
supersedes: []
tags:
  - payments
  - architecture
ttl_days: null
---

All Stripe webhook traffic terminates in the payments service under
src/jobs/webhook.ts. Other services consume payment events from the
internal queue, never from Stripe directly. Add new webhook handlers to the
dispatcher table in that file rather than registering new endpoints.
