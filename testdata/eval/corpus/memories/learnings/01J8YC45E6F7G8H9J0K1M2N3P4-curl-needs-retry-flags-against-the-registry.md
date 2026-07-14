---
id: 01J8YC45E6F7G8H9J0K1M2N3P4
class: learning
scope: team
status: active
priority: advisory
title: "curl needs retry flags against the registry"
created: 2026-06-28
evidence:
  sessions:
    - s_01J8YC1B2C3D4E5F6G7H8J9K0M
    - s_01J8YC2C3D4E5F6G7H8J9K0M1N
  commits:
    - 4a5b6c7
supersedes: []
tags:
  - ci
ttl_days: null
---

Pass `--retry 3 --retry-delay 2` to curl when hitting the internal
package registry; bare invocations flake behind the office proxy. The
same applies when you fetch tarballs in CI scripts.
