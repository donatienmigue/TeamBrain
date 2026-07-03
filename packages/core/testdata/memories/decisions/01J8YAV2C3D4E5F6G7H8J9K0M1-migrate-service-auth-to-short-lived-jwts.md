---
id: 01J8YAV2C3D4E5F6G7H8J9K0M1
class: decision
scope: team
status: active
priority: advisory
title: "Migrate service auth to short-lived JWTs"
created: 2026-06-12
evidence:
  sessions:
    - s_01J8Y8Z1A2B3C4D5E6F7G8H9J0
    - s_01J8Y901B2C3D4E5F6G7H8J9K0
  commits:
    - a1b2c3d
supersedes:
  - 01J8YBC2Z1A2B3C4D5E6F7G8H9
tags:
  - auth
  - security
ttl_days: null
---

Issue service-to-service tokens as JWTs with a 15-minute expiry, signed by
the auth service. Do not mint long-lived API keys for new integrations;
existing keys are being phased out per the retirement of the old policy.
Rotate signing keys quarterly via the standard secrets pipeline.
