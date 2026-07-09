/** Shared CLI help copy (M8.3 per-command help). Kept in one module for tests. */

export const ROOT_HELP_AFTER = `
TeamBrain stores team memories as markdown in .teambrain/ and serves them to
AI agents via MCP. Git is the source of truth; ~/.teambrain/ holds the local
index and redacted session spool (never synced to the brain repo).

Exit codes:
  0  success
  1  user error (bad flags, missing brain, unknown memory id)
  2  environment error (daemon unreachable, missing gh, corrupt config)
  3  lint / validation failure

Getting started:
  $ tb init                          scan rules + ADRs → teambrain/init PR branch
  $ tb install claude-code             register MCP server + capture wiring
  $ tb serve                           start daemon (leave running in a terminal)
  $ tb doctor                          verify daemon, index, and capture heartbeats

Day-to-day:
  $ tb audit --last-session            show what the last session recorded
  $ tb propose --class learning --title "..." --body "..."
  $ tb retire 01H... "reason"          open a PR retiring a memory

CI / automation:
  $ tb lint .teambrain --require-evidence
  $ tb distill --dry-run
  $ tb digest --dry-run

Docs: FORMAT.md (memory spec) · SECURITY.md (threat model) · ci-templates/

Run \`tb <command> --help\` for examples and options.`;

export const HELP = {
  lint: `
Examples:
  $ tb lint
  $ tb lint .teambrain/memories/decisions/
  $ tb lint .teambrain --require-evidence

Validates schema, title/body size limits, evidence (with --require-evidence),
and injection heuristics (instruction-like patterns, tool syntax, etc.).
Exit 3 on any violation — used as the PR gate in ci-templates/lint.yml.`,

  init: `
Examples:
  $ tb init
  $ tb init ../other-repo --yes

Scans CLAUDE.md, AGENTS.md, .cursor/rules/, and docs/adr/ for importable
knowledge. Writes .teambrain/ on branch teambrain/init (never touches main).
The interview asks up to 10 skippable questions when stdin is a TTY; --yes
or a non-TTY stdin skips it.`,

  install: `
Examples:
  $ tb install claude-code
  $ tb install cursor .
  $ tb install claude-code --yes

Shows a diff before writing agent config (.claude/settings.json or Cursor
equivalents). Registers the MCP server and capture hooks. Idempotent — a
second run with no config drift produces zero changes.`,

  serve: `
Examples:
  $ tb serve
  $ tb serve ../monorepo

Watches .teambrain/ for changes, maintains the SQLite index, and accepts hook
events on ~/.teambrain/daemon.sock. Run in the background during agent
sessions. Exits cleanly on SIGINT/SIGTERM.`,

  mcp: `
Examples:
  $ tb mcp
  $ tb mcp --client cursor

stdio MCP server exposing memory_search, memory_context, memory_retrieve, and
memory_propose. Registered by \`tb install\`; agent tools spawn this process.
Not intended for direct interactive use.`,

  audit: `
Examples:
  $ tb audit
  $ tb audit --last-session
  $ tb audit 01HXYZ...

Prints the session record exactly as stored (metadata-only by default) plus a
redaction summary ("N replacements: …"). This is the trust feature — verify
what left your machine before it reaches the sessions branch.`,

  distill: `
Examples:
  $ tb distill --dry-run
  $ tb distill

Reads new records on teambrain/sessions, clusters struggle signals, drafts
memories via the LLM in brain.yaml, deduplicates, and opens a
teambrain/proposals-<date> PR (≤10 candidates). Requires gh and a Provider
API key in CI. --dry-run prints the would-be PR with no git side effects.`,

  retire: `
Examples:
  $ tb retire 01HABCD1234567890 "Superseded by the auth refactor"
  $ tb retire 01H... "No longer applies" ../monorepo

Finds the memory by ULID, moves it to retired/ with status: retired, and opens
a PR. Never writes to main.`,

  digest: `
Examples:
  $ tb digest --dry-run
  $ set TEAMBRAIN_SLACK_WEBHOOK=https://hooks.slack.com/... && tb digest

Aggregates proposal, retrieval, and drift stats with no per-person fields
(enforced by construction). Posts to Slack when TEAMBRAIN_SLACK_WEBHOOK is
set; --dry-run or a missing webhook prints JSON instead.`,

  propose: `
Examples:
  $ tb propose --class learning --title "Use pnpm not npm" --body "..."
  $ echo "details..." | tb propose --class convention --title "Import order"

Queues a zod-validated candidate to ~/.teambrain/spool/ for the next distill
run. Never writes to the brain — distill opens a PR for human review. Body
from --body or stdin; cites the most recent session as evidence.`,

  reindex: `
Examples:
  $ tb reindex
  $ tb reindex ../monorepo

Forces a full SQLite rebuild from .teambrain/. Safe anytime — git is the
source of truth. Use when doctor reports index/brain mismatch or after
recovering from a corrupt index.db.`,

  doctor: `
Examples:
  $ tb doctor
  $ tb doctor --json

Reports daemon liveness, index freshness, hook heartbeats, retrieval p95, and
brain branch sync. Exit 0 when the daemon socket is reachable; 2 otherwise.
--json emits a machine-readable report (schema-validated in tests).`,

  hook: `
Examples:
  $ tb hook session-start

Installed by \`tb install\` into agent hook config — not for direct use.
Always exits 0 so agent sessions are never blocked (fire-and-forget capture).

Events:
  session-start    inject memory_context into the agent session
  post-tool-use    capture tool metadata (paths, exit codes — never content)
  stop             session winding down
  session-end      finalize and persist the session record`,
} as const;

/** Attach trailing help examples to a commander subcommand. */
export function commandHelpAfter(text: string): string {
  return text.trimStart();
}
