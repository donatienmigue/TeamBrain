# @teambrain/hooks

**Thin capture adapters: agent tool events → TeamBrain session records.**

Turns Claude Code hook payloads (and Cursor MCP-side inference) into
metadata-only session events, redacts them on-device, and fire-and-forgets
them to the local daemon.

- **Privacy contract in code**: a `tool_use` event carries only
  `{kind, path?, exit_code?}` — content fields (`old_string`, `new_string`,
  command output, prompts) are structurally dropped, then every surviving
  string is run through [`@teambrain/redact`](https://www.npmjs.com/package/@teambrain/redact)
  before anything touches disk.
- **Never blocks a session**: handlers run in well under 20ms p95 (enforced
  by benchmark test) and exit 0 unconditionally; if the daemon is down,
  events drop silently.
- **Claude Code**: SessionStart (context inject), PostToolUse, Stop /
  SessionEnd. **Cursor**: rules-directive + MCP-side session inference
  (Cursor has no native lifecycle hooks; edit/command telemetry is
  unavailable and reported as degraded by `tb doctor`).

```sh
npm install @teambrain/hooks
```

Part of [TeamBrain](https://github.com/donatienmigue/TeamBrain) — `tb install
claude-code|cursor` from
[`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli) wires these
up; you rarely use this package directly.

Apache-2.0
