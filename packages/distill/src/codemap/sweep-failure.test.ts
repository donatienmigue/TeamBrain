import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@teambrain/core';
import { fakeProvider } from '../fake-provider.js';
import { updateCodemap } from './generate.js';

// R16.1 T5 negative: an unremovable entry must be LOGGED with a reason, not
// silently swallowed (CLAUDE.md forbids silent degradation), and the sweep
// retries it next run. The failure is injected by intercepting rmSync for one
// marked path — cross-platform, unlike chmod tricks.

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: ((path: Parameters<typeof actual.rmSync>[0], options) => {
      if (String(path).endsWith('locked-entry.ts.md')) {
        throw new Error('EBUSY: simulated locked file');
      }
      actual.rmSync(path, options);
    }) as typeof actual.rmSync,
  };
});

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0)
    rmSync(cleanups.pop() as string, { recursive: true, force: true });
});

function spyLogger(): { logger: Logger; entries: Array<[string, unknown]> } {
  const entries: Array<[string, unknown]> = [];
  const record =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      entries.push([`${level}: ${message}`, fields]);
    };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    } as unknown as Logger,
  };
}

describe('orphan sweep failed delete (R16.1 T5 negative)', () => {
  it('logs the failure with a reason and reports the entry as not swept', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'tb-sweep-fail-'));
    cleanups.push(repoRoot);
    const brainDir = join(repoRoot, '.teambrain');
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(repoRoot, 'src', 'locked-entry.ts'),
      'export const l = 1;\n',
    );
    const provider = fakeProvider(({ prompt }) => ({
      summary: `Summary of ${/^File: (.*)$/m.exec(prompt)?.[1] ?? '?'}.`,
    }));
    const now = { now: () => new Date('2026-07-15T12:00:00Z') };
    await updateCodemap({ repoRoot, brainDir, provider, ...now });

    // The source file goes away, but its entry cannot be deleted.
    rmSync(join(repoRoot, 'src', 'locked-entry.ts'));
    const { logger, entries } = spyLogger();
    const result = await updateCodemap({
      repoRoot,
      brainDir,
      provider,
      logger,
      ...now,
    });

    // Manifest-diff still reports the source file as removed…
    expect(result.removed).toEqual(['src/locked-entry.ts']);
    // …but the entry was NOT swept (delete failed), and that is visible:
    expect(result.orphaned).toEqual([]);
    const failureLog = entries.find(([message]) =>
      message.includes('codemap sweep failed to delete stale entry'),
    );
    expect(failureLog).toBeDefined();
    expect(failureLog?.[1]).toMatchObject({
      path: 'src/locked-entry.ts',
      reason: expect.stringContaining('EBUSY') as unknown,
    });
    // The stale entry is still on disk (the failure is real)…
    expect(
      existsSync(
        join(brainDir, 'codemap', 'files', 'src', 'locked-entry.ts.md'),
      ),
    ).toBe(true);
    // …and it is no longer in the manifest, so the next successful sweep
    // (rmSync healthy again) removes it as an orphan.
    expect(result.summarized).toEqual([]);
  });
});
