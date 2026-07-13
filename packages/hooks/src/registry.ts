import type { CaptureAdapter } from './adapter.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { cursorAdapter } from './adapters/cursor.js';
import { codexAdapter } from './adapters/codex.js';
import { geminiAdapter } from './adapters/gemini.js';

// A0.3 the adapter registry. Adding a vendor is: write the adapter file,
// add it here. `tb install`, `tb doctor`, and the README capture matrix all
// resolve from this record, so nothing else needs touching.
//
// Cline, Kiro and Antigravity have A1 spike memos (DEVLOG 2026-07-13) but no
// verified install surface — per the adapters plan they are BLOCKED, and a
// blocked vendor gets no adapter (an empty install plan would report
// "installed" while capturing nothing). Serving still works for any MCP
// client the user configures by hand.

export const ADAPTERS: Record<string, CaptureAdapter> = {
  [claudeCodeAdapter.tool]: claudeCodeAdapter,
  [cursorAdapter.tool]: cursorAdapter,
  [codexAdapter.tool]: codexAdapter,
  [geminiAdapter.tool]: geminiAdapter,
};

/** Registry keys, sorted — the `tb install <tool>` argument set. */
export function supportedTools(): string[] {
  return Object.keys(ADAPTERS).sort();
}
