import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAuditCommand } from './audit-command.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function runtimeWithSpool(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-audit-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'spool'), { recursive: true });
  return dir;
}

function record(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

describe('tb audit (M5.4)', () => {
  it('prints the record verbatim with a typed redaction summary', async () => {
    const runtimeDir = await runtimeWithSpool();
    await writeFile(
      join(runtimeDir, 'spool', 'sess-1.jsonl'),
      record(
        {
          v: 1,
          sid: 'sess-1',
          ev: 'tool_use',
          data: { kind: 'edit', path: 'src/«REDACTED:aws_access_key».ts' },
        },
        {
          v: 1,
          sid: 'sess-1',
          ev: 'tool_use',
          data: { kind: 'edit', path: 'x/«REDACTED:aws_access_key».ts' },
        },
        {
          v: 1,
          sid: 'sess-1',
          ev: 'intent',
          data: { summary: 'contact «REDACTED:email»' },
        },
      ),
      'utf8',
    );
    const { exitCode, output } = runAuditCommand({ runtimeDir, sid: 'sess-1' });
    expect(exitCode).toBe(0);
    expect(output).toContain('Session sess-1 — 3 events');
    expect(output).toContain('"kind":"edit"'); // verbatim record
    expect(output).toContain(
      'Redaction summary: 3 replacements: 2 aws_access_key, 1 email.',
    );
  });

  it('defaults to the most recently modified record', async () => {
    const runtimeDir = await runtimeWithSpool();
    const older = join(runtimeDir, 'spool', 'old.jsonl');
    const newer = join(runtimeDir, 'spool', 'new.jsonl');
    await writeFile(
      older,
      record({ v: 1, sid: 'old', ev: 'session_start', data: {} }),
      'utf8',
    );
    await writeFile(
      newer,
      record({ v: 1, sid: 'new', ev: 'session_start', data: {} }),
      'utf8',
    );
    const past = new Date(Date.now() - 60_000);
    await utimes(older, past, past);
    const { output } = runAuditCommand({ runtimeDir });
    expect(output).toContain('Session new');
  });

  it('reports cleanly when there are no records', async () => {
    const runtimeDir = await runtimeWithSpool();
    const { exitCode, output } = runAuditCommand({ runtimeDir });
    expect(exitCode).toBe(1);
    expect(output).toContain('no session records');
  });

  it('shows a zero-replacement summary for a clean record', async () => {
    const runtimeDir = await runtimeWithSpool();
    await writeFile(
      join(runtimeDir, 'spool', 's.jsonl'),
      record({
        v: 1,
        sid: 's',
        ev: 'tool_use',
        data: { kind: 'command', exit_code: 0 },
      }),
      'utf8',
    );
    const { output } = runAuditCommand({ runtimeDir, sid: 's' });
    expect(output).toContain('Redaction summary: 0 replacements.');
  });
});
