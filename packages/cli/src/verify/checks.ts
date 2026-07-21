import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createTools,
  heartbeatPath,
  indexDbPath,
  openBackend,
  sessionSpoolDir,
  userScopeDir,
} from '@teambrain/mcp';
import { loadRedactionCorpus, redactString } from '@teambrain/redact';
import type { SessionEvent } from '@teambrain/core';
import { toAggregateEvent } from '../digest/aggregate.js';
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
// V1 provenance · V2 egress (child-process instrumentation) · V3 no content in
// spool · V4 redaction corpus vs the installed redactor · V5 digest people-free
// · V6 user-scope isolation · V7 retired-unserved · V8 repo scoping (D5.1). The
// breadth floor in verify.test.ts tracks the registry size so it cannot
// silently shrink.

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

// --- V1: provenance (the installed code is the audited code) ---

/** The seven published @teambrain/* packages (stable monorepo set). */
export const TEAMBRAIN_PACKAGES = [
  '@teambrain/core',
  '@teambrain/index',
  '@teambrain/mcp',
  '@teambrain/hooks',
  '@teambrain/redact',
  '@teambrain/distill',
  '@teambrain/cli',
] as const;

/** Probe one package's published provenance. Throws when the registry is unreachable. */
export type ProvenanceProbe = (pkg: string, version: string) => boolean;

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** Default probe: ask the registry whether the published tarball is attested. */
export const registryProvenanceProbe: ProvenanceProbe = (pkg, version) => {
  // Throws (ENOENT / network / unknown version) → the caller treats it as
  // "could not run" and reports UNVERIFIED, never PASS. `shell: true` is
  // required on Windows, where Node ≥ 20 refuses to execFile a `.cmd` directly
  // (EINVAL); pkg names and the version are trusted (module constants /
  // CORE_VERSION), so there is no injection surface here.
  const predicate = execFileSync(
    npmBin(),
    ['view', `${pkg}@${version}`, 'dist.attestations.provenance.predicateType'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true },
  ).trim();
  return predicate.length > 0;
};

/**
 * V1 core, extracted for deterministic tests: given a probe, decide the
 * provenance verdict. A missing attestation on any package is a FAIL (a
 * tampered @teambrain/redact would defeat every other check). A probe that
 * throws (offline / registry down) is UNVERIFIED — never silently PASS.
 */
export function runProvenanceCheck(
  version: string,
  probe: ProvenanceProbe,
): CheckOutcome {
  const claim =
    'Every installed @teambrain/* package carries an npm provenance attestation (slsa.dev/provenance/v1) for this version.';
  const attested: string[] = [];
  const missing: string[] = [];
  for (const pkg of TEAMBRAIN_PACKAGES) {
    let has: boolean;
    try {
      has = probe(pkg, version);
    } catch (err) {
      return outcome('V1', 'provenance', 'UNVERIFIED', claim, [
        `could not reach the registry to verify provenance: ${(err as Error).message.split('\n')[0]}`,
        'offline provenance is UNVERIFIED, never PASS',
      ]);
    }
    if (has) attested.push(pkg);
    else missing.push(pkg);
  }
  if (missing.length > 0) {
    return outcome('V1', 'provenance', 'FAIL', claim, [
      `${attested.length}/${TEAMBRAIN_PACKAGES.length} attested`,
      ...missing.map((p) => `no provenance attestation: ${p}`),
    ]);
  }
  return outcome('V1', 'provenance', 'PASS', claim, [
    `${attested.length}/${TEAMBRAIN_PACKAGES.length} packages carry an slsa.dev/provenance/v1 attestation for ${version}`,
    'full sigstore-chain verification is not performed at this tier (registry attestation presence only)',
  ]);
}

export const checkProvenance: Check = {
  id: 'V1',
  name: 'provenance',
  run(ctx: CheckContext): CheckOutcome {
    if (ctx.offline) {
      return outcome(
        'V1',
        'provenance',
        'UNVERIFIED',
        'Provenance requires the registry; skipped (offline).',
        ['offline provenance is UNVERIFIED, never PASS'],
      );
    }
    return runProvenanceCheck(ctx.version, registryProvenanceProbe);
  },
};

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

// --- V4: redaction corpus against the installed redactor ---

export type RedactFn = (input: string) => {
  text: string;
  replacements: string[];
};

export interface CorpusRunResult {
  pass: boolean;
  positives: number;
  negatives: number;
  detectors: number;
  /** Case ids + failure kind only — never inputs or secret values. */
  failures: string[];
}

/**
 * Runs the shipped public corpus through a redactor. Extracted so the negative
 * control can pass a deliberately-weakened redactor and prove V4 FAILs.
 */
export function runRedactionCorpus(redact: RedactFn): CorpusRunResult {
  const corpus = loadRedactionCorpus();
  const detectors = new Set<string>();
  const failures: string[] = [];
  let positives = 0;
  let negatives = 0;
  for (const c of corpus) {
    const { text, replacements } = redact(c.input);
    if (c.kind === 'positive') {
      positives++;
      for (const type of c.expect_types ?? []) {
        detectors.add(type);
        if (!replacements.includes(type))
          failures.push(`${c.id}:missed:${type}`);
      }
      if (c.secret !== undefined && text.includes(c.secret)) {
        failures.push(`${c.id}:secret-survived`);
      }
    } else {
      negatives++;
      if (replacements.length > 0 || text !== c.input) {
        failures.push(`${c.id}:false-positive`);
      }
    }
  }
  return {
    pass: failures.length === 0,
    positives,
    negatives,
    detectors: detectors.size,
    failures,
  };
}

/**
 * Runs the release-gating corpus against the INSTALLED redactor (not the
 * repo's tests). A regression — a leaked secret or a false positive — is an
 * invariant violation (exit 3).
 */
export const checkRedactionCorpus: Check = {
  id: 'V4',
  name: 'redaction corpus',
  run(): CheckOutcome {
    const claim =
      'The public redaction corpus passes against the installed redactor (no leaked secret, no false positive).';
    const r = runRedactionCorpus((s) => redactString(s, 'strict'));
    const evidence = [
      `${r.positives} positive / ${r.negatives} negative case(s), ${r.detectors} detector type(s)`,
    ];
    if (!r.pass) {
      return outcome('V4', 'redaction corpus', 'FAIL', claim, [
        ...evidence,
        ...r.failures,
      ]);
    }
    return outcome('V4', 'redaction corpus', 'PASS', claim, evidence);
  },
};

// --- V5: digest aggregation is people-free ---

/**
 * The digest aggregation must drop every identity-bearing field. This runs the
 * INSTALLED projection (`toAggregateEvent`) over the user's real spool and
 * asserts (a) the projection keeps only {ev,data} and (b) no `sid` value
 * survives into the aggregate (identity smuggled through a data payload). The
 * other four identity fields are covered by the structural (a) assertion.
 */
export const checkDigestPeopleFree: Check = {
  id: 'V5',
  name: 'digest people-free',
  run(ctx: CheckContext): CheckOutcome {
    const claim =
      'The digest aggregation drops every identity-bearing field (sid/tool/model/repo/branch) from your spool.';
    const spoolDir = sessionSpoolDir(ctx.runtimeDir);
    if (!existsSync(spoolDir)) {
      return outcome('V5', 'digest people-free', 'PASS', claim, [
        'spool: none present (0 events)',
      ]);
    }
    const files = readdirSync(spoolDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort();

    const violations: string[] = [];
    let events = 0;
    for (const name of files) {
      const lines = readFileSync(join(spoolDir, name), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as string;
        if (line.trim() === '') continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        events++;
        const aggregate = toAggregateEvent(
          parsed as unknown as SessionEvent,
        ) as unknown as Record<string, unknown>;
        for (const key of Object.keys(aggregate)) {
          if (key !== 'ev' && key !== 'data') {
            violations.push(`${name}:${i + 1}:projection-leaked-key:${key}`);
          }
        }
        const sid = parsed['sid'];
        if (typeof sid === 'string' && sid.length >= 8) {
          if (JSON.stringify(aggregate).includes(sid)) {
            violations.push(`${name}:${i + 1}:identity-leaked:sid`);
          }
        }
      }
    }

    if (violations.length > 0) {
      return outcome('V5', 'digest people-free', 'FAIL', claim, [
        `${events} event(s) scanned`,
        ...violations,
      ]);
    }
    return outcome('V5', 'digest people-free', 'PASS', claim, [
      `${events} event(s) scanned; projection people-free`,
    ]);
  },
};

// --- V2: egress allowlist under instrumentation ---

/**
 * The compiled sibling of this module (egress-probe.js / egress-driver.js).
 * Under vitest this module runs from `src/`, but the spawned probe/driver are
 * built JS — map src→dist so both `pnpm test` (after build) and the installed
 * CLI resolve the same files.
 */
function distSibling(name: string): string {
  const dir = dirname(fileURLToPath(import.meta.url)).replace(
    `${sep}src${sep}`,
    `${sep}dist${sep}`,
  );
  return join(dir, name);
}

export interface EgressReplayResult {
  ran: boolean;
  destinations: string[];
  detail: string;
}

/**
 * Spawns the driver under the egress probe and returns the JS-layer
 * connections it observed. `driverPath` is overridable so the negative control
 * can point at a driver that deliberately connects out.
 */
export function runEgressReplay(opts: {
  runtimeDir: string;
  brainDir: string;
  driverPath?: string;
}): EgressReplayResult {
  const probePath = distSibling('egress-probe.js');
  const driverPath = opts.driverPath ?? distSibling('egress-driver.js');
  if (!existsSync(probePath) || !existsSync(driverPath)) {
    return {
      ran: false,
      destinations: [],
      detail: 'instrumentation not built (run pnpm build)',
    };
  }
  const outDir = mkdtempSync(join(tmpdir(), 'tb-egress-'));
  const outFile = join(outDir, 'out.json');
  try {
    const res = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(probePath).href, driverPath],
      {
        env: {
          ...process.env,
          TB_EGRESS_OUT: outFile,
          TB_VERIFY_RUNTIME: opts.runtimeDir,
          TB_VERIFY_BRAIN: opts.brainDir,
        },
        encoding: 'utf8',
        timeout: 25000,
      },
    );
    if (!existsSync(outFile)) {
      const stderr = (res.stderr ?? '')
        .split('\n')
        .find((l) => l.trim() !== '');
      return {
        ran: false,
        destinations: [],
        detail: `probe produced no output${stderr ? `: ${stderr}` : ''}`,
      };
    }
    let destinations: string[] = [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(outFile, 'utf8'));
      if (Array.isArray(parsed)) destinations = parsed.map((d) => String(d));
    } catch {
      return {
        ran: false,
        destinations: [],
        detail: 'unreadable probe output',
      };
    }
    return {
      ran: true,
      destinations,
      detail: `${destinations.length} JS-layer connection(s) observed`,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Replays a serve+search session under socket instrumentation. Serving must
 * open no JS-layer connection — any destination is a violation. The claim is
 * scoped to the JS surface per OQ-8; --strict runs it under an OS sandbox.
 */
export const checkEgress: Check = {
  id: 'V2',
  name: 'egress allowlist',
  run(ctx: CheckContext): CheckOutcome {
    const claim =
      "During a scripted serve+search session, TeamBrain's JavaScript surface opened no network connection. Native-module sockets (better-sqlite3, ONNX) are not observable at this layer (OQ-8); --strict runs the replay under an OS-level deny-all network sandbox.";
    const replay = runEgressReplay({
      runtimeDir: ctx.runtimeDir,
      brainDir: ctx.brainDir,
    });
    if (!replay.ran) {
      return outcome('V2', 'egress allowlist', 'UNVERIFIED', claim, [
        `could not run the instrumented replay: ${replay.detail}`,
      ]);
    }
    if (replay.destinations.length > 0) {
      return outcome('V2', 'egress allowlist', 'FAIL', claim, [
        'serving opened JS-layer connection(s):',
        ...replay.destinations.map((d) => `connected: ${d}`),
      ]);
    }
    return outcome('V2', 'egress allowlist', 'PASS', claim, [
      'serve+search replay opened 0 JS-layer connections',
    ]);
  },
};

// --- V7: retired memories are never served ---

interface RetiredMemory {
  id: string;
  title: string;
}

function readRetired(retiredDir: string): RetiredMemory[] {
  const out: RetiredMemory[] = [];
  for (const entry of readdirSync(retiredDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const body = readFileSync(join(retiredDir, entry.name), 'utf8');
    const id =
      /^id:\s*(\S+)/m.exec(body)?.[1] ?? (entry.name.split('-')[0] as string);
    const title = /^title:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? id;
    out.push({ id, title });
  }
  return out;
}

/**
 * The R5 negative test, run on the user's OWN live index: every memory in
 * retired/ must be absent from what the index serves. Queries the existing
 * index (no resync — a fresh rebuild would never index retired/ and pass
 * vacuously); a stale index still serving a retired memory is exactly the bug
 * this catches.
 */
export const checkRetiredUnserved: Check = {
  id: 'V7',
  name: 'retired memories unserved',
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const claim =
      'No memory in retired/ is returned by the live index (the R5 guarantee, on your brain).';
    const retiredDir = join(ctx.brainDir, 'retired');
    if (!existsSync(retiredDir)) {
      return outcome('V7', 'retired memories unserved', 'PASS', claim, [
        'no retired/ directory (nothing to serve)',
      ]);
    }
    const retired = readRetired(retiredDir);
    if (retired.length === 0) {
      return outcome('V7', 'retired memories unserved', 'PASS', claim, [
        '0 retired memories',
      ]);
    }
    if (!existsSync(indexDbPath(ctx.runtimeDir))) {
      return outcome('V7', 'retired memories unserved', 'UNVERIFIED', claim, [
        'no local index to query (run `tb serve` or `tb reindex` first)',
      ]);
    }
    const handle = await openBackend({
      runtimeDir: ctx.runtimeDir,
      embedder: null,
    });
    try {
      if (handle.index.stats().docCount === 0) {
        return outcome('V7', 'retired memories unserved', 'UNVERIFIED', claim, [
          'the index is empty; nothing to check',
        ]);
      }
      const tools = createTools(handle.context);
      const served = new Set<string>();
      for (const m of retired) {
        for (const r of await tools.memorySearch({ query: m.title, k: 8 })) {
          served.add(r.id);
        }
      }
      const leaked = retired.filter((m) => served.has(m.id));
      if (leaked.length > 0) {
        return outcome('V7', 'retired memories unserved', 'FAIL', claim, [
          `${retired.length} retired memories checked`,
          ...leaked.map((m) => `still served: ${m.id}`),
        ]);
      }
      return outcome('V7', 'retired memories unserved', 'PASS', claim, [
        `${retired.length} retired memories checked; none served`,
      ]);
    } finally {
      handle.close();
    }
  },
};

/** The check registry, in id order. The breadth floor guards its size. */
export const CHECK_REGISTRY: readonly Check[] = [
  checkProvenance, // V1
  checkEgress, // V2
  checkNoContentInSpool, // V3
  checkRedactionCorpus, // V4
  checkDigestPeopleFree, // V5
  checkUserScopeIsolation, // V6
  checkRetiredUnserved, // V7
  checkRepoScoping, // V8
];
