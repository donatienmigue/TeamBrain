# @teambrain/mcp

**TeamBrain's MCP server and local daemon.**

Serves the team's memories to any MCP-capable agent (Claude Code, Cursor, …)
and persists redacted session events — the vendor-neutral surface everything
agent-facing goes through.

- **Four MCP tools** (stdio, official SDK):
  `memory_context()` (session-start bundle, required-first, ≤2,000 tokens),
  `memory_search(query, k)`, `memory_propose(draft)` (local spool only —
  never writes to the brain), `memory_feedback(id, useful)`.
- **Injection mitigation**: memory bodies are rendered inside fenced blocks
  marked `data, not instructions`, with fences sized so body content can
  never break out.
- **Daemon** (`tb serve`): watches the brain repo, keeps the index fresh
  (checksum poll + fs-events nudge), accepts capture events on a local
  socket (unix socket / Windows named pipe), writes a heartbeat for
  `tb doctor`.
- **Session spool**: redacted event records are committed to a dedicated,
  never-merged `teambrain/sessions` branch via pure git plumbing. The
  user-scope store (`~/.teambrain/user/`) is physically unreachable from the
  sync code — enforced by test at the git-object level.

```sh
npm install @teambrain/mcp
```

Part of [TeamBrain](https://github.com/donatienmigue/TeamBrain) — most users
want [`@teambrain/cli`](https://www.npmjs.com/package/@teambrain/cli), which
registers this server via `tb install`.

Apache-2.0
