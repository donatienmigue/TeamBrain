# @teambrain/redact

**On-device redaction for TeamBrain session capture. Pure, dependency-free.**

Runs in the hook path before any event touches the spool — nothing leaves the
machine un-redacted.

- **Layered detectors**: gitleaks-compatible secret patterns (API keys, JWTs,
  private keys, connection strings), a Shannon-entropy scanner for unknown
  opaque tokens (≥20 chars, >4.5 bits/char — hex like git SHAs mathematically
  cannot trip it), and PII patterns (email/phone/IP) at the strict level.
- **Typed replacements** — `«REDACTED:aws_key»` — so downstream distillation
  keeps the *signal* ("a key was here") without the content, and `tb audit`
  can summarize replacements per session.
- **Deny-glob path filter** honoring `.gitignore` and `brain.yaml` deny rules:
  events touching matching paths are dropped entirely.
- **Public adversarial corpus as a release gate**: the test corpus (true
  positives per detector plus tricky negatives like UUIDs and git SHAs) ships
  in this package and CI fails on any regression.

```sh
npm install @teambrain/redact
```

Part of [TeamBrain](https://github.com/donatienmigue/TeamBrain) — most users
want [`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli).

Apache-2.0
