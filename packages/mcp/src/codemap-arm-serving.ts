import { codemapArm } from '@teambrain/core';
import type { MemoryView } from './render.js';

// R16.1 T7b: the ONE decision point for the codemap control-arm bypass. Both
// serving surfaces — the daemon's SessionStart bundle and the MCP server's
// memory_search — key their behavior off this single predicate so the arms
// can never disagree. A control session is served no codemap at all (no index
// block, no slice, and search excludes source 'codemap'): byte-identical to a
// session on a repo where CodeMap is off — the clean CM6 measurement baseline.

/**
 * Whether this session should be served codemap content. A session with no
 * identity signal (`sid` undefined — a bare `memory_context` call) is treated
 * as treatment (serve), preserving pre-holdout behavior. Deterministic per sid.
 */
export function servesCodemap(
  sid: string | undefined,
  holdout: number,
): boolean {
  if (sid === undefined || sid.length === 0) return true;
  return codemapArm(sid, holdout) === 'treatment';
}

/**
 * The search-side bypass: drops codemap-sourced results for a control session.
 * A no-op for treatment sessions (returns the list unchanged).
 */
export function filterSearchForArm(
  views: MemoryView[],
  serves: boolean,
): MemoryView[] {
  return serves ? views : views.filter((view) => view.source !== 'codemap');
}
