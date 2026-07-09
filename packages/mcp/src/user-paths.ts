import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// C7 user scope: `~/.teambrain/user/` is machine-local and NEVER synced.
// The physical-separation guarantee (CONTRACTS C7, TECH_BRIEF §5 "scope
// leakage") is architectural, not behavioral: this is the ONLY module that
// knows the path, and the sync code (spool.ts and the path helpers it uses,
// paths.ts) must never import it — user-scope-separation.test.ts asserts
// both that module boundary and, at the git-object level, that nothing under
// user/ ever reaches a pushed tree. Do not re-export these helpers from
// paths.ts or import them in spool.ts; that would dissolve the guarantee.

/** The user-scope store (C7): private memories that never leave the machine. */
export function userScopeDir(runtimeDir: string): string {
  return join(runtimeDir, 'user');
}

/** Materializes the C7 layout's user/ dir; called by CLI entrypoints only. */
export function ensureUserScopeDir(runtimeDir: string): string {
  const dir = userScopeDir(runtimeDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}
