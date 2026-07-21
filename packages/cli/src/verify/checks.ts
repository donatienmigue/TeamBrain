import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { heartbeatPath, sessionSpoolDir, userScopeDir } from '@teambrain/mcp';
import type {
  Check,
  CheckContext,
  CheckOutcome,
  CheckStatus,
} from './framework.js';

// E1 checks V1–V8 (EVIDENCE_BRIEF §5.1). Each maps to a claim in §3 and must
// UNDER-claim: the evidence lines report path:line:key, NEVER a scanned value
// (§E.1 — a verifier that echoes the secret it found is a vulnerability).
//
// This file currently implements the self-contained, offline, fully-testable
// checks (V3, V6, V8). V1 (provenance), V2 (egress under instrumentation),
// V4 (redaction corpus) and V5 (digest people-free) follow in the next E1
// increment; the breadth floor in verify.test.ts tracks the registry size so
// the set cannot silently shrink.

function outcome(
  id: string,
  name: string,
  status: CheckStatus,
  claim: string,
  evidence: readonly string[],
): CheckOutcome {
  return { id, name, status, claim, evidence };
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** True when `child` is at or below `parent` in the filesystem tree. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return (
    rel === '' ||
    (!rel.startsWith('..') && !rel.startsWith(sep) && !/^\.\.[/\\]/.test(rel))
  );
}

const SESSIONS_BRANCH = 'teambrain/sessions';

// --- V8: repo scoping (closes D5.1) ---

/**
 * The brain being verified must belong to THIS repo, and any running daemon's
 * heartbeat must describe THIS brain — not a different repo's (the D5.1 bug,
 * where `tb doctor` reported another repo's daemon and still exited 0). This
 * is the shared scoping fact doctor also consumes.
 */
export const checkRepoScoping: Check = {
  id: 'V8',
  name: 'repo scoping',
  run(ctx: CheckContext): CheckOutcome {
    const evidence: string[] = [`brain: ${ctx.brainDir}`];
    if (!isInside(ctx.repoDir, ctx.brainDir)) {
      return outcome(
        'V8',
        'repo scoping',
        'FAIL',
        'The brain being verified is not inside the target repo.',
        [...evidence, `repo: ${ctx.repoDir}`],
      );
    }

    // Compare against a running daemon's heartbeat, if any.
    const hbPath = heartbeatPath(ctx.runtimeDir);
    let daemonBrain: string | null = null;
    if (existsSync(hbPath)) {
      try {
        const hb: unknown = JSON.parse(readFileSync(hbPath, 'utf8'));
        if (hb !== null && typeof hb === 'object' && 'brainDir' in hb) {
          const b = (hb as { brainDir?: unknown }).brainDir;
          if (typeof b === 'string') daemonBrain = b;
        }
      } catch {
        daemonBrain = null;
      }
    }

    if (daemonBrain === null) {
      return outcome(
        'V8',
        'repo scoping',
        'PASS',
        'The brain is inside the target repo; no daemon heartbeat to cross-check.',
        [...evidence, 'daemon brain: none reported'],
      );
    }
    if (resolve(daemonBrain) !== resolve(ctx.brainDir)) {
      return outcome(
        'V8',
        'repo scoping',
        'FAIL',
        "A running daemon is serving a DIFFERENT repo's brain (D5.1).",
        [...evidence, `daemon brain: ${daemonBrain}`],
      );
    }
    return outcome(
      'V8',
      'repo scoping',
      'PASS',
      'The brain is inside the target repo and the running daemon serves it.',
      [...evidence, `daemon brain: ${daemonBrain}`],
    );
  },
};

// --- V3: no content in the session spool ---

const FORBIDDEN_KEYS = new Set([
  'content',
  'old_string',
  'new_string',
  'command',
]);
const INTENT_MAX_CHARS = 200; // C2 intent ceiling

/** Collect forbidden-key paths in a parsed JSON value. Returns key names only. */
function forbiddenKeyHits(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.has(key)) hits.push(key);
        walk(child);
      }
    }
  };
  walk(value);
  return hits;
}

/**
 * Scans the user's actual on-disk spool for content/diff keys and any `intent`
 * exceeding the 200-char ceiling. Reports file:line:key — never the value.
 */
export const checkNoContentInSpool: Check = {
  id: 'V3',
  name: 'no content in events',
  run(ctx: CheckContext): CheckOutcome {
    const spoolDir = sessionSpoolDir(ctx.runtimeDir);
    const claim =
      'No content/diff keys, and no over-long intent, in the on-disk session spool.';
    if (!existsSync(spoolDir)) {
      return outcome('V3', 'no content in events', 'PASS', claim, [
        'spool: none present (0 files scanned)',
      ]);
    }
    const files = readdirSync(spoolDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort();

    const violations: string[] = [];
    let linesScanned = 0;
    for (const name of files) {
      const full = join(spoolDir, name);
      const lines = readFileSync(full, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as string;
        if (line.trim() === '') continue;
        linesScanned++;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // malformed line: not a content leak
        }
        for (const key of forbiddenKeyHits(parsed)) {
          violations.push(`${name}:${i + 1}:${key}`);
        }
        // intent ceiling — length is metadata, safe to print; value is not.
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          (parsed as { ev?: unknown }).ev === 'intent'
        ) {
          const data = (parsed as { data?: unknown }).data;
          if (typeof data === 'string' && data.length > INTENT_MAX_CHARS) {
            violations.push(`${name}:${i + 1}:intent-length=${data.length}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      return outcome('V3', 'no content in events', 'FAIL', claim, [
        `${files.length} file(s), ${linesScanned} event(s) scanned`,
        ...violations,
      ]);
    }
    return outcome('V3', 'no content in events', 'PASS', claim, [
      `${files.length} file(s), ${linesScanned} event(s) scanned; no content keys, no over-long intent`,
    ]);
  },
};

// --- V6: user-scope isolation ---

/**
 * `~/.teambrain/user/` is machine-local (C7) and its module boundary is
 * enforced by user-scope-separation.test.ts (release-gating). At runtime we
 * add the git-object assertion: nothing under a `user/` path may exist on the
 * pushed sessions branch.
 */
export const checkUserScopeIsolation: Check = {
  id: 'V6',
  name: 'user-scope isolation',
  run(ctx: CheckContext): CheckOutcome {
    const claim =
      'No user-scope path is present on the pushed sessions branch.';
    const userDir = userScopeDir(ctx.runtimeDir);
    const evidence: string[] = [
      `user scope: ${userDir} (machine-local, never synced)`,
    ];

    // Does the sessions branch exist?
    const branchRef = git(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${SESSIONS_BRANCH}`],
      ctx.repoDir,
    );
    if (branchRef === null) {
      return outcome('V6', 'user-scope isolation', 'PASS', claim, [
        ...evidence,
        `no ${SESSIONS_BRANCH} branch; nothing has been pushed`,
      ]);
    }
    const tree = git(
      ['ls-tree', '-r', '--name-only', SESSIONS_BRANCH],
      ctx.repoDir,
    );
    if (tree === null) {
      return outcome('V6', 'user-scope isolation', 'UNVERIFIED', claim, [
        ...evidence,
        `could not read ${SESSIONS_BRANCH} tree`,
      ]);
    }
    const offenders = tree
      .split('\n')
      .filter((p) => p.trim() !== '')
      .filter((p) => /(^|\/)user\//.test(p));
    if (offenders.length > 0) {
      return outcome('V6', 'user-scope isolation', 'FAIL', claim, [
        ...evidence,
        ...offenders.map((p) => `leaked: ${p}`),
      ]);
    }
    return outcome('V6', 'user-scope isolation', 'PASS', claim, [
      ...evidence,
      `${SESSIONS_BRANCH} tree carries no user/ path`,
    ]);
  },
};

/** The check registry, in id order. The breadth floor guards its size. */
export const CHECK_REGISTRY: readonly Check[] = [
  checkNoContentInSpool, // V3
  checkUserScopeIsolation, // V6
  checkRepoScoping, // V8
];
