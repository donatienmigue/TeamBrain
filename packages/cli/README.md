# @teambrain/cli

**`tb` — git-native, cross-vendor shared memory for AI coding agents.**

TeamBrain gives Claude Code, Cursor, and other MCP-capable agents one shared,
human-governed memory: markdown files in your repo, served over MCP by a local
daemon, with new memories proposed as pull requests — never written silently.

```sh
npm install -g @teambrain/cli
```

## Quick start

```sh
tb init                  # import CLAUDE.md / .cursorrules / ADRs → a PR branch
tb install claude-code   # register the MCP server + capture wiring (also: cursor)
tb serve                 # run the local daemon (index + watcher + MCP backend)
tb doctor                # verify daemon, index, and capture health
```

## Everyday commands

```sh
tb audit --last-session   # see exactly what was recorded, post-redaction
tb propose --class learning --title "..." --body "..."   # queue a candidate
tb retire <id> "reason"   # open a PR retiring a memory
tb reindex                # rebuild the local index (recovery path)
tb lint .teambrain        # validate memories (schema, size, injection heuristics)
tb distill --dry-run      # (CI) cluster sessions → memory-proposals PR
tb digest --dry-run       # (CI) people-free weekly digest
```

Run `tb --help` or `tb <command> --help` for grouped help, exit codes, and
examples.

## How it works

- **Git is the source of truth.** Memories are markdown + YAML front-matter in
  `.teambrain/`; approval is a pull request, history is `git log`.
- **A local daemon serves them over MCP** (`memory_context`, `memory_search`,
  `memory_propose`, `memory_feedback`) with hybrid lexical + vector retrieval.
- **Capture is metadata-only and redacted on-device** — never raw prompts,
  file contents, or diffs. `tb audit` shows you exactly what was stored.
- **Nothing writes to the brain without a human merge.** Automation proposes;
  people approve.

## Part of TeamBrain

This is the command-line entrypoint. The implementation lives in
[`@teambrain/core`](https://www.npmjs.com/package/@teambrain/core),
[`@teambrain/index`](https://www.npmjs.com/package/@teambrain/index),
[`@teambrain/mcp`](https://www.npmjs.com/package/@teambrain/mcp),
[`@teambrain/hooks`](https://www.npmjs.com/package/@teambrain/hooks),
[`@teambrain/redact`](https://www.npmjs.com/package/@teambrain/redact), and
[`@teambrain/distill`](https://www.npmjs.com/package/@teambrain/distill).

Full docs, format spec, and threat model:
[github.com/donatienmigue/TeamBrain](https://github.com/donatienmigue/TeamBrain)

Apache-2.0
