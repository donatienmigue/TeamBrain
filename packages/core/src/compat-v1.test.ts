import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBrainConfig } from './brain-config.js';
import { parseMemoryFile, serializeMemoryFile } from './frontmatter.js';
import { parseSessionEventLine, serializeSessionEvent } from './events.js';

// I0.3 compat gate (AUDIT.md F7): testdata/compat/v1-brain/ is a frozen
// snapshot of the v1 on-disk formats, generated from the code as it stood
// on main. Future code must keep reading it BYTE-correctly — if this test
// breaks, either a parser regressed or a serialization change silently
// altered the canonical form (a C1/C2 "additive evolution only" violation).
// Never regenerate the fixture to make this test pass; that inverts the gate.

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../testdata/compat/v1-brain/', import.meta.url),
);

/** All fixture memory ids, active and retired — the fixture's table of contents. */
const ACTIVE_IDS = [
  '01JZCP0A1B2C3D4E5F6G7H8J9K', // decision (required, evidence, supersedes)
  '01JZCP1B2C3D4E5F6G7H8J9KAM', // convention
  '01JZCP2C3D4E5F6G7H8J9KAMBN', // map (scope: org)
  '01JZCP3D4E5F6G7H8J9KAMBNCP', // learning (ttl_days: 90)
] as const;
const RETIRED_ID = '01JZCP4E5F6G7H8J9KAMBNCPDQ';

async function markdownFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath ?? dir, entry.name))
    .sort();
}

describe('v1-brain compat fixture (I0.3 / F7)', () => {
  it('reads every memory file byte-correctly (parse → serialize → same bytes)', async () => {
    const files = [
      ...(await markdownFilesUnder(join(FIXTURE_DIR, 'memories'))),
      ...(await markdownFilesUnder(join(FIXTURE_DIR, 'retired'))),
    ];
    expect(files).toHaveLength(ACTIVE_IDS.length + 1);
    for (const file of files) {
      const bytes = await readFile(file, 'utf8');
      const parsed = parseMemoryFile(bytes);
      expect(
        serializeMemoryFile({ ...parsed.frontmatter, body: parsed.body }),
        `${file} must round-trip byte-exactly`,
      ).toBe(bytes);
    }
  });

  it('parses the expected memories with their v1 field values intact', async () => {
    const byId = new Map<string, ReturnType<typeof parseMemoryFile>>();
    for (const file of [
      ...(await markdownFilesUnder(join(FIXTURE_DIR, 'memories'))),
      ...(await markdownFilesUnder(join(FIXTURE_DIR, 'retired'))),
    ]) {
      const parsed = parseMemoryFile(await readFile(file, 'utf8'));
      byId.set(parsed.frontmatter.id, parsed);
    }
    for (const id of ACTIVE_IDS) {
      expect(byId.get(id)?.frontmatter.status, id).toBe('active');
    }
    expect(byId.get(RETIRED_ID)?.frontmatter.status).toBe('retired');

    // Spot-check the fields the fixture deliberately exercises, so a lossy
    // parser change (dropped evidence, coerced ttl) fails loudly here.
    const decision = byId.get(ACTIVE_IDS[0])?.frontmatter;
    expect(decision?.priority).toBe('required');
    expect(decision?.evidence).toEqual({
      sessions: ['cmpt-001'],
      commits: ['4a15c9c'],
    });
    expect(decision?.supersedes).toEqual(['01JZCNZZ9Y8X7W6V5T4S3R2Q1P']);
    expect(byId.get(ACTIVE_IDS[2])?.frontmatter.scope).toBe('org');
    expect(byId.get(ACTIVE_IDS[3])?.frontmatter.ttl_days).toBe(90);
  });

  it('reads brain.yaml with v1 capture/redaction levels', async () => {
    const config = parseBrainConfig(
      await readFile(join(FIXTURE_DIR, 'brain.yaml'), 'utf8'),
    );
    expect(config.version).toBe(1);
    expect(config.capture.level).toBe('metadata');
    expect(config.redaction.level).toBe('strict');
  });

  it('reads the session record byte-correctly, join keys on every event', async () => {
    const record = await readFile(
      join(FIXTURE_DIR, 'sessions', 'cmpt-001.jsonl'),
      'utf8',
    );
    const lines = record.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      const event = parseSessionEventLine(line);
      expect(serializeSessionEvent(event), 'C2 line must round-trip').toBe(
        line,
      );
      expect(event.sid).toBe('cmpt-001');
      expect(event.tool).toBe('claude-code');
      expect(event.repo).toBe('acme/web');
      expect(event.branch).toBe('feat/checkout');
      expect(event.model.length).toBeGreaterThan(0);
    }
    expect(parseSessionEventLine(lines[0] as string).ev).toBe('session_start');
    const last = parseSessionEventLine(lines[lines.length - 1] as string);
    expect(last.ev).toBe('session_end');
    if (last.ev === 'session_end') {
      expect(last.data.commit_shas).toEqual(['ceedb17']);
    }
  });
});
