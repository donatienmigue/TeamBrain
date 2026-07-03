---
id: 01J8YB9X3FQK7S1T2V3W4X5Y6Z
class: learning
scope: team
status: active
priority: advisory
title: "S3 client needs custom retry wrapper"
created: 2026-07-02
evidence:
  sessions:
    - s_01J8Y8Z1A2B3C4D5E6F7G8H9J0
    - s_01J8Y901B2C3D4E5F6G7H8J9K0
  commits:
    - a1b2c3d
    - e4f5a6b
supersedes: []
tags:
  - aws
  - reliability
ttl_days: 90
---

Wrap S3 calls in the shared retry helper from lib/retry.ts; the SDK default
retries do not cover the 503 SlowDown responses our bucket returns under
batch load. Retry with jittered exponential backoff, five attempts, and
surface the final error unmodified.
