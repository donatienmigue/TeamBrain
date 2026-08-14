---
'@teambrain/cli': patch
---

`tb lint <repo-root>` now resolves one level into `.teambrain/` instead of
reporting a `[schema]` violation for the missing `brain.yaml`. A directory with
no brain is a user error (exit 1, `no brain found`), not a lint failure (exit
3). A brain with `memories/` but a deleted `brain.yaml` still reports the schema
violation. Reported by an external tester (field report 001).
