import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildQuery,
  runRelevantCommand,
  type RelevantRow,
} from './relevant-command.js';
import {
  MAX_ROWS,
  REVIEW_MARKER,
  renderReviewComment,
} from './review-comment.js';

const temps: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold the sqlite handle; the OS reaps it.
    }
  }
});

function memoryFile(
  dir: string,
  name: string,
  id: string,
  status: 'active' | 'retired',
  body: string,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    [
      '---',
      `id: ${id}`,
      'class: convention',
      'scope: team',
      `status: ${status}`,
      'priority: advisory',
      `title: "${status} ${id.slice(0, 6)}"`,
      'created: 2026-07-07',
      'supersedes: []',
      'tags: []',
      'ttl_days: null',
      '---',
      '',
      body,
      '',
    ].join('\n'),
  );
}

const ACTIVE = '01KWZCBRH96QQWCB99QWYKGG56';
const RETIRED = '01KWZCBRHA7RPP78CS2VASHS9N';

describe('buildQuery', () => {
  it('segments paths and folds in the free-text query', () => {
    const q = buildQuery(['src/auth/login-flow.ts'], 'rate limiting');
    expect(q).toContain('rate limiting');
    expect(q).toContain('auth');
    expect(q).toContain('login');
    expect(q).not.toContain('/');
  });
});

describe('tb relevant', () => {
  it('never surfaces a retired memory (C4/R5 filter honoured)', async () => {
    const repo = tmp('tb-rel-');
    const brainDir = join(repo, '.teambrain');
    // Both mention PELICAN; only the active one may surface.
    memoryFile(
      join(brainDir, 'memories', 'conventions'),
      `${ACTIVE}-a.md`,
      ACTIVE,
      'active',
      'The PELICAN protocol governs retries.',
    );
    memoryFile(
      join(brainDir, 'memories', 'conventions'),
      `${RETIRED}-r.md`,
      RETIRED,
      'retired',
      'The old PELICAN protocol, retired.',
    );

    const { exitCode, output } = await runRelevantCommand(repo, {
      query: 'PELICAN protocol',
      json: true,
    });
    expect(exitCode).toBe(0);
    const rows = JSON.parse(output) as RelevantRow[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ACTIVE);
    expect(ids).not.toContain(RETIRED);
    // Rows carry ONLY public fields — no session/author/telemetry.
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['class', 'id', 'title']);
    }
  });

  it('no brain → exit 0 with empty results (fails open for the Action)', async () => {
    const repo = tmp('tb-rel-nobrain-');
    const { exitCode, output } = await runRelevantCommand(repo, {
      query: 'anything',
      json: true,
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual([]);
  });
});

describe('review comment', () => {
  it('caps at 5 rows, carries the sticky marker, and links retirement', () => {
    const rows: RelevantRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: `01ID${String(i).padStart(22, '0')}`,
      title: `memory ${i}`,
      class: 'convention',
    }));
    const body = renderReviewComment(rows);
    expect(body).not.toBeNull();
    expect(body).toContain(REVIEW_MARKER);
    // Exactly MAX_ROWS data rows (count the retire hints).
    expect(body?.match(/tb retire/g)?.length).toBe(MAX_ROWS);
    expect(body).toContain('propose retirement');
    // No leaked telemetry — the body mentions no session/author fields.
    expect(body?.toLowerCase()).not.toContain('sid');
    expect(body?.toLowerCase()).not.toContain('session');
    expect(body?.toLowerCase()).not.toContain('author');
  });

  it('returns null when there is nothing to show (Action posts nothing)', () => {
    expect(renderReviewComment([])).toBeNull();
  });
});
