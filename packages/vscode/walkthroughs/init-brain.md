## Import what you already wrote down

```
tb init
```

`tb init` scans `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/` and `docs/adr/`, and
converts them into memories under `.teambrain/`.

It writes to the branch `teambrain/init` and never touches `main`. Review it
like any other change and merge it when it looks right — that is the same
approval path every future memory takes.
