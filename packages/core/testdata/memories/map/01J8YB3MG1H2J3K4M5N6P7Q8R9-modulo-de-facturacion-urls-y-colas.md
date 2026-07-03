---
id: 01J8YB3MG1H2J3K4M5N6P7Q8R9
class: map
scope: team
status: active
priority: advisory
title: "Módulo de facturación: URLs y colas"
created: 2026-06-22
supersedes: []
tags:
  - billing
  - i18n
ttl_days: null
---

Route invoice generation through the billing module queue named
billing.invoices; the HTTP surface under /api/facturacion is a thin shim
that only enqueues. Locale-specific tax rules live in the module itself,
not in the callers.
