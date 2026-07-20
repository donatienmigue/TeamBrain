// R16.1 T7 (holdout): deterministic per-session control/treatment assignment
// for the CodeMap measurement. A control session is served no codemap at all
// (no index block, no slice, and memory_search excludes source 'codemap'), so
// it behaves exactly like a pre-CodeMap session — the clean baseline the CM6
// gate is measured against. The assignment is a pure function of the session
// id + holdout fraction: the SAME sid must always land in the SAME arm, in
// every process (the SessionStart hook that tags the event, the daemon that
// serves the bundle, and the MCP server that serves search) — otherwise the
// arms disagree and the measurement is biased.

export type CodemapArm = 'control' | 'treatment';

/**
 * FNV-1a (32-bit) over the UTF-8 bytes of `input`. A tiny, stable,
 * dependency-free hash (boring-dependencies rule): the only property we need
 * is that the same string always yields the same number, in any process.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff;
    // 32-bit FNV prime multiply via shifts, kept in uint32 with >>> 0.
    hash =
      (hash +
        ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

/**
 * Assigns a session to the control or treatment arm. `holdout` is the fraction
 * (0–1) of sessions held out as control; `hash(sid) % 100 < holdout*100` puts
 * that share in control. `holdout <= 0` → always treatment; `holdout >= 1` →
 * always control. Deterministic per sid.
 */
export function codemapArm(sid: string, holdout: number): CodemapArm {
  if (!(holdout > 0)) return 'treatment'; // 0, negative, or NaN → no holdout
  if (holdout >= 1) return 'control';
  return fnv1a(sid) % 100 < holdout * 100 ? 'control' : 'treatment';
}

/**
 * The effective holdout given the codemap config. When CodeMap is disabled
 * there is nothing to hold out — every session already behaves as control —
 * so the effective holdout is 0 and `codemapArm` returns 'treatment' for all
 * sids (the arm tag is meaningless but harmless; serving is off regardless).
 */
export function effectiveHoldout(codemap: {
  enabled: boolean;
  holdout?: number;
}): number {
  if (!codemap.enabled) return 0;
  return codemap.holdout ?? 0;
}
