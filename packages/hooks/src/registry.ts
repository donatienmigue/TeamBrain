import type { CaptureAdapter } from './adapter.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { cursorAdapter } from './adapters/cursor.js';
import { codexAdapter } from './adapters/codex.js';

// A0.3 the adapter registry. Adding a vendor is: write the adapter file,
// add it here. `tb install`, `tb doctor`, and the README capture matrix all
// resolve from this record, so nothing else needs touching.

export const ADAPTERS: Record<string, CaptureAdapter> = {
  [claudeCodeAdapter.tool]: claudeCodeAdapter,
  [cursorAdapter.tool]: cursorAdapter,
  [codexAdapter.tool]: codexAdapter,
};

/** Registry keys, sorted — the `tb install <tool>` argument set. */
export function supportedTools(): string[] {
  return Object.keys(ADAPTERS).sort();
}
