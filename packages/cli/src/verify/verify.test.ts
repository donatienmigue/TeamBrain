import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReport,
  EGRESS_ALLOWLIST,
  renderJson,
  resolveExitCode,
  verifyReportSchema,
  type CheckContext,
  type CheckOutcome,
} from './framework.js';
import { redactString } from '@teambrain/redact';
import {
  CHECK_REGISTRY,
  checkDigestPeopleFree,
  checkRepoScoping,
  checkRetiredUnserved,
  checkUserScopeIsolation,
  runEgressReplay,
  runProvenanceCheck,
  runRedactionCorpus,
  TEAMBRAIN_PACKAGES,
} from './checks.js';
import { runVerifyCommand } from './verify-command.js';

// E1 tests. TMPDIR fakes only — never the real ~/.teambrain (CLAUDE.md). The
// negative controls (guardrail 4) prove each guarantee FAILS (exit 3) when
// deliberately broken; the no-secret test proves scanned values never reach
// any output path (§E.1).

const temps: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A repo with an initialized brain (no sessions branch, no spool). */
function makeBrainRepo(): string {
  const repo = tmp('tb-verify-repo-');
  mkdirSync(join(repo, '.teambrain', 'memories', 'decisions'), {
    recursive: true,
  });
  writeFileSync(
    join(repo, '.teambrain', 'memories', 'decisions', '01H-example.md'),
    '---\nid: 01H\nclass: decision\n---\nbody\n',
  );
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function makeHome(): string {
  return tmp('tb-verify-home-');
}

function spoolLine(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

describe('tb verify — framework', () => {
  it('exit code is 3 > 2 > 0 (violation outranks environment gap)', () => {
    const mk = (status: CheckOutcome['status']): CheckOutcome => ({
      id: 'X',
      name: 'x',
      status,
      claim: '',
      evidence: [],
    });
    expect(resolveExitCode([mk('PASS'), mk('PASS')])).toBe(0);
    expect(resolveExitCode([mk('PASS'), mk('UNVERIFIED')])).toBe(2);
    expect(resolveExitCode([mk('UNVERIFIED'), mk('FAIL')])).toBe(3);
  });

  it('report validates against the JSON schema and orders checks by id', () => {
    const outcomes: CheckOutcome[] = [
      { id: 'V8', name: 'b', status: 'PASS', claim: '', evidence: [] },
      { id: 'V3', name: 'a', status: 'PASS', claim: '', evidence: [] },
    ];
    const report = buildReport(outcomes, {
      version: '9.9.9',
      provenanceCommit: null,
      brainMemoryCount: 0,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(() => verifyReportSchema.parse(report)).not.toThrow();
    expect(report.checks.map((c) => c.id)).toEqual(['V3', 'V8']);
    expect(report.verdict).toBe('PASS');
  });

  it('renders a stable --json golden (pins the allowlist + shape)', () => {
    const report = buildReport(
      [
        {
          id: 'V1',
          name: 'provenance',
          status: 'UNVERIFIED',
          claim: 'c1',
          evidence: ['offline'],
        },
        {
          id: 'V3',
          name: 'no content in events',
          status: 'PASS',
          claim: 'c3',
          evidence: [],
        },
      ],
      {
        version: '1.2.3',
        provenanceCommit: null,
        brainMemoryCount: 7,
        generatedAt: '2026-07-21T00:00:00.000Z',
      },
    );
    expect(JSON.parse(renderJson(report))).toEqual({
      tool: 'tb verify',
      verdict: 'UNVERIFIED',
      exitCode: 2,
      version: '1.2.3',
      provenanceCommit: null,
      brainMemoryCount: 7,
      generatedAt: '2026-07-21T00:00:00.000Z',
      allowlist: EGRESS_ALLOWLIST.map((a) => ({ ...a })),
      checks: [
        {
          id: 'V1',
          name: 'provenance',
          status: 'UNVERIFIED',
          claim: 'c1',
          evidence: ['offline'],
        },
        {
          id: 'V3',
          name: 'no content in events',
          status: 'PASS',
          claim: 'c3',
          evidence: [],
        },
      ],
    });
  });

  it('the allowlist names the F8 embedding endpoint openly', () => {
    const hosts = EGRESS_ALLOWLIST.map((a) => a.host).join(' ');
    expect(hosts).toContain('storage.googleapis.com/qdrant-fastembed');
    const sources = EGRESS_ALLOWLIST.map((a) => a.source).join(' ');
    expect(sources).toContain('F8');
  });
});

describe('tb verify — happy path', () => {
  it('a clean brain offline: every local check PASSes, provenance is UNVERIFIED (exit 2)', async () => {
    const repo = makeBrainRepo();
    const home = makeHome();
    const { exitCode, output } = await runVerifyCommand(repo, {
      runtimeDir: home,
      offline: true, // deterministic: no registry call in unit tests
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    // Offline provenance is UNVERIFIED, never PASS — so the verdict is
    // UNVERIFIED (exit 2), not a false green. Every LOCAL check still passes.
    expect(exitCode).toBe(2);
    expect(output).toContain('tb verify — UNVERIFIED');
    expect(output).toContain('V1 · provenance — UNVERIFIED');
    expect(output).toContain('V8 · repo scoping — PASS');
    expect(output).toContain('V3 · no content in events — PASS');
  });

  it('exits 1 with a clear message when the repo has no brain', async () => {
    const repo = tmp('tb-verify-nobrain-');
    const { exitCode, output } = await runVerifyCommand(repo, {
      runtimeDir: makeHome(),
    });
    expect(exitCode).toBe(1);
    expect(output).toContain('no brain here');
  });
});

describe('tb verify — negative controls (guarantee must FAIL when broken)', () => {
  it('V3: a content key in the spool trips exit 3 — and never prints the value', async () => {
    const repo = makeBrainRepo();
    const home = makeHome();
    const secret = 'SUPER_SECRET_DIFF_BODY_9f8e7d6c';
    const longIntent = 'x'.repeat(250);
    mkdirSync(join(home, 'spool'), { recursive: true });
    writeFileSync(
      join(home, 'spool', 'S1.jsonl'),
      spoolLine({
        v: 1,
        sid: 'S1',
        ev: 'tool_use',
        data: { content: secret },
      }) + spoolLine({ v: 1, sid: 'S1', ev: 'intent', data: longIntent }),
    );

    const { exitCode, output } = await runVerifyCommand(repo, {
      runtimeDir: home,
      offline: true,
    });
    expect(exitCode).toBe(3);
    expect(output).toContain('S1.jsonl:1:content');
    expect(output).toContain('S1.jsonl:2:intent-length=250');
    // The scanned value must never appear in any output path.
    expect(output).not.toContain(secret);
    expect(output).not.toContain(longIntent);

    // Same for --json.
    const asJson = await runVerifyCommand(repo, {
      runtimeDir: home,
      json: true,
      offline: true,
    });
    expect(asJson.output).not.toContain(secret);
    expect(asJson.output).not.toContain(longIntent);
  });

  it('V6: a user/ path on the sessions branch trips exit 3', () => {
    const repo = makeBrainRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'teambrain/sessions'], {
      cwd: repo,
    });
    mkdirSync(join(repo, 'user'), { recursive: true });
    writeFileSync(join(repo, 'user', 'private.md'), 'leaked\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@t.invalid',
        '-c',
        'user.name=t',
        'commit',
        '-qm',
        'x',
      ],
      {
        cwd: repo,
      },
    );

    const ctx: CheckContext = {
      version: '0.0.0-test',
      repoDir: repo,
      brainDir: join(repo, '.teambrain'),
      runtimeDir: makeHome(),
      offline: false,
      strict: false,
      now: () => new Date(),
    };
    const result = checkUserScopeIsolation.run(ctx) as CheckOutcome;
    expect(result.status).toBe('FAIL');
    expect(result.evidence.join(' ')).toContain('user/private.md');
  });

  it('V8: a daemon serving a different brain trips exit 3 (D5.1)', () => {
    const repo = makeBrainRepo();
    const home = makeHome();
    writeFileSync(
      join(home, 'daemon.json'),
      JSON.stringify({
        brainDir: join(tmpdir(), 'some-other-repo', '.teambrain'),
      }),
    );
    const ctx: CheckContext = {
      version: '0.0.0-test',
      repoDir: repo,
      brainDir: join(repo, '.teambrain'),
      runtimeDir: home,
      offline: false,
      strict: false,
      now: () => new Date(),
    };
    const result = checkRepoScoping.run(ctx) as CheckOutcome;
    expect(result.status).toBe('FAIL');
    expect(result.claim).toContain('DIFFERENT');
  });

  it('V4: a no-op redactor fails the corpus (secrets survive)', () => {
    // Negative control: the installed corpus must be able to detect a broken
    // redactor. Passing the input through untouched leaves every positive's
    // secret in place.
    const broken = runRedactionCorpus((s) => ({ text: s, replacements: [] }));
    expect(broken.pass).toBe(false);
    expect(broken.failures.length).toBeGreaterThan(0);
    // The real redactor passes the same corpus.
    const real = runRedactionCorpus((s) => redactString(s, 'strict'));
    expect(real.pass).toBe(true);
    // Failure detail is case ids only — never the secret input.
    expect(broken.failures.join(' ')).not.toMatch(/AKIA|glpat|sk_live/);
  });

  it('V1: a missing attestation on any package is a FAIL', () => {
    const probe = (pkg: string): boolean => pkg !== '@teambrain/redact';
    const result = runProvenanceCheck('1.0.0', probe);
    expect(result.status).toBe('FAIL');
    expect(result.evidence.join(' ')).toContain('@teambrain/redact');
  });

  it('V1: an unreachable registry is UNVERIFIED, never PASS', () => {
    const probe = (): boolean => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
    };
    const result = runProvenanceCheck('1.0.0', probe);
    expect(result.status).toBe('UNVERIFIED');
  });

  it('V1: all seven packages attested is a PASS', () => {
    const result = runProvenanceCheck('1.0.0', () => true);
    expect(result.status).toBe('PASS');
    expect(result.evidence.join(' ')).toContain(
      `${TEAMBRAIN_PACKAGES.length}/${TEAMBRAIN_PACKAGES.length}`,
    );
  });

  it('V2: the probe catches a deliberate outbound connection', () => {
    // Negative control: the instrumentation must be able to see egress. A
    // driver that connects out to a non-allowlisted address must be recorded.
    const badDriver = join(tmp('tb-bad-driver-'), 'bad.mjs');
    writeFileSync(
      badDriver,
      [
        "import net from 'node:net';",
        "const s = net.connect({ host: '127.0.0.1', port: 9 });",
        "s.on('error', () => {});",
        'setTimeout(() => process.exit(0), 30);',
        '',
      ].join('\n'),
    );
    const result = runEgressReplay({
      runtimeDir: makeHome(),
      brainDir: join(makeBrainRepo(), '.teambrain'),
      driverPath: badDriver,
    });
    expect(result.ran).toBe(true);
    expect(result.destinations.some((d) => d.includes('127.0.0.1:9'))).toBe(
      true,
    );
  });

  it('V7: retired memories with no local index is UNVERIFIED, not a vacuous pass', async () => {
    const repo = makeBrainRepo();
    mkdirSync(join(repo, '.teambrain', 'retired'), { recursive: true });
    writeFileSync(
      join(repo, '.teambrain', 'retired', '01HRETIRED-x.md'),
      '---\nid: 01HRETIRED\ntitle: old convention\n---\nbody\n',
    );
    const ctx: CheckContext = {
      version: '0.0.0-test',
      repoDir: repo,
      brainDir: join(repo, '.teambrain'),
      runtimeDir: makeHome(), // no index.db here
      offline: false,
      strict: false,
      now: () => new Date(),
    };
    const result = (await checkRetiredUnserved.run(ctx)) as CheckOutcome;
    expect(result.status).toBe('UNVERIFIED');
  });

  it('V7: no retired/ directory passes', async () => {
    const repo = makeBrainRepo();
    const ctx: CheckContext = {
      version: '0.0.0-test',
      repoDir: repo,
      brainDir: join(repo, '.teambrain'),
      runtimeDir: makeHome(),
      offline: false,
      strict: false,
      now: () => new Date(),
    };
    const result = (await checkRetiredUnserved.run(ctx)) as CheckOutcome;
    expect(result.status).toBe('PASS');
  });

  it('V5: identity smuggled through a data payload trips exit 3', () => {
    const repo = makeBrainRepo();
    const home = makeHome();
    const sid = '01ABCDEFGHIJKLMNOP';
    mkdirSync(join(home, 'spool'), { recursive: true });
    writeFileSync(
      join(home, 'spool', `${sid}.jsonl`),
      spoolLine({ v: 1, sid, ev: 'intent', data: `refactor in ${sid}` }),
    );
    const ctx: CheckContext = {
      version: '0.0.0-test',
      repoDir: repo,
      brainDir: join(repo, '.teambrain'),
      runtimeDir: home,
      offline: false,
      strict: false,
      now: () => new Date(),
    };
    const result = checkDigestPeopleFree.run(ctx) as CheckOutcome;
    expect(result.status).toBe('FAIL');
    expect(result.evidence.join(' ')).toContain('identity-leaked:sid');
  });
});

describe('tb verify — breadth floor', () => {
  it('the check registry cannot silently shrink', () => {
    // Grows to 8 (V1–V8) across the E1 increments; never below what exists.
    expect(CHECK_REGISTRY.length).toBeGreaterThanOrEqual(8);
    const ids = CHECK_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });
});
