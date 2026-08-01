# VS Code extension — build-or-skip decision and staged plan

Source: the build-or-skip assessment (2026-07/08). Verdict: **build, but
deliberately thin.** VS Code's native MCP support went GA in 1.102, so the
protocol plumbing already exists and `@teambrain/cli` works there today with a
hand-written `.vscode/mcp.json`. The extension's entire job is to collapse that
setup to one install and to surface PR-governed memory in the UI. It must not
re-implement memory.

## Decisions, and what each one rules out

1. **Zero-config registration is the whole MVP.** `contributes.
   mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider`
   replaces the six manual steps (install CLI, open the config command, hand-write
   a JSON block with correct paths, trust the server, enable it, confirm the org
   policy) with installing the extension.
2. **Never bundle native modules.** better-sqlite3 / sqlite-vec / fastembed
   compile against a `NODE_MODULE_VERSION` that Electron does not share; shipping
   them would mean platform-specific VSIX targets and activation failures. The
   extension spawns `@teambrain/cli` as a child-process stdio server instead —
   which is exactly what `McpStdioServerDefinition` exists for. This is enforced
   by `src/packaging.test.ts`, which bundles the extension and asserts the output
   contains no native module and no `child_process`.
3. **No telemetry at all**, not even flag-gated network telemetry. The product's
   ethics apply to its own instrumentation (CLAUDE.md guardrail 4). The same
   packaging test fails the build on `fetch(`, an http/https/net require, or a
   `TelemetryLogger`.
4. **The cross-fork caveat is encoded, not documented away.** The registration
   API is consumed only by genuine VS Code + Copilot; Cursor has an open request
   for it since Sept 2025 and offers a proprietary
   `vscode.cursor.mcp.registerServer`, and Windsurf configures MCP only through
   its own file. Since the VSIX ships to Open VSX it *installs* in those
   editors, so `src/host.ts` probes for the API and the extension degrades to
   writing `.vscode/mcp.json` — and the status bar says so rather than claiming
   success.
5. **FlightDeck stays out.** An IDE extension is the wrong surface for
   leadership analytics and would create exactly the telemetry tension the
   product is designed against.

## Stage 1 — shipped

- `packages/vscode`: provider registration, CLI resolution (setting →
  workspace `node_modules/.bin/tb` → PATH), status bar, walkthrough, the
  manual-config fallback command, dual-registry publish workflow on a
  `vscode-v*` tag.
- `vscode` added to the capture-adapter registry (`packages/hooks`), so the
  spawned server runs as `tb mcp <repo> --client vscode` and gets MCP-side
  session inference for free — the same Tier-B path Cursor and Codex use. The
  README capture matrix regenerates from the declared capabilities, so the new
  column cannot overclaim.
- `tb install vscode` writes the equivalent `.vscode/mcp.json` (VS Code's
  `servers` root key, not Claude's `mcpServers`) plus an owned
  `.github/instructions/teambrain.instructions.md`. A drift test asserts the
  extension's fallback writes byte-identical config.

Deliberately not in scope: in-process retrieval or embeddings, bundled native
modules, a platform-specific VSIX matrix, custom LLM calls, FlightDeck.

## Stage 2 — governance UI (next, once the MVP has traction)

- "Pending Memories" TreeView: memories awaiting PR approval, read from the
  `teambrain/proposals-*` branches the distiller already opens.
- `QuickDiffProvider` review of a proposed memory against the current tree —
  the differentiator ("memory as reviewable markdown") made visible.
- Optional `@teambrain` chat participant / `lm.registerTool` for natural-language
  recall. Gated on the MVP proving the on-ramp, because both duplicate what the
  MCP tools already do.

## Stage 3 — cross-fork parity, only if the data justifies it

Cursor's proprietary `cursor.mcp.registerServer` path and a Windsurf
`mcp_config.json` writer. Re-verify both APIs before starting: the fallback
command already covers the functional gap, so this is convenience, not
capability.

## Benchmarks that change this plan

- VS Code's built-in memory tool or Copilot Memory adding **team sync +
  governance** → pull Stage 2 forward immediately; that is the only feature
  that narrows the differentiator.
- Cursor or Windsurf shipping the registration API → start Stage 3.
- MVP installs under ~100 after a full quarter of promotion (the category
  leader sits around 2,600) → the extension is not the adoption lever; redirect
  to CLI onboarding and the AGENTS.md ecosystem.

## Caveats to carry into the listing

- **Org policy gating.** MCP in Copilot is disabled by default for enterprises
  and needs an admin to enable it. No extension can work around this; the
  README and the walkthrough both say so up front.
- **Fast-moving area.** These findings track docs and release notes through
  roughly mid-2026. Re-verify the fork API status before Stage 3.
- **Marketplace hygiene.** VS Code Marketplace needs an Azure DevOps PAT
  (`VSCE_PAT`); Open VSX needs an Eclipse publisher agreement and a claimed
  namespace (`OVSX_PAT`). Verified status on the Marketplace requires the
  publisher to be six months old.
