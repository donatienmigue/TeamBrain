import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openIndex, syncIndexWithBrain, type SqliteIndex } from '@teambrain/index';
import type { ToolContext } from './tools.js';

// Shared test utilities (not exported from the package).

/** Absolute path to the checked-in M4 fixture brain. */
export function fixtureBrainDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/mcp/src → repo root → testdata/brains/mcp-fixture
  return join(here, '..', '..', '..', 'testdata', 'brains', 'mcp-fixture');
}

/** The fixture's memory ids, by role in the tests. */
export const FIXTURE_IDS = {
  requiredZod: '01J9MA1B2C3D4E5F6G7H8J9K0M',
  decisionPnpm: '01J9MB2C3D4E5F6G7H8J9K0M1N',
  mapDaemon: '01J9MC3D4E5F6G7H8J9K0M1N2P',
  learningFts: '01J9MD4E5F6G7H8J9K0M1N2P3Q',
  learningRedis: '01J9ME5F6G7H8J9K0M1N2P3Q4R',
} as const;

/** Opens an in-memory index synced from a brain dir (lexical-only by default). */
export async function indexForBrain(brainDir: string): Promise<SqliteIndex> {
  const index = await openIndex({ dbPath: ':memory:', embedder: null });
  await syncIndexWithBrain(index, brainDir);
  return index;
}

/** A temp runtime dir (spool target) with an auto-cleanup registered. */
export async function tempRuntimeDir(
  cleanups: Array<() => Promise<void> | void>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-mcp-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function toolContextFor(
  index: SqliteIndex,
  runtimeDir: string,
): ToolContext {
  return {
    backend: index,
    spoolDir: join(runtimeDir, 'spool', 'candidates'),
    feedbackPath: join(runtimeDir, 'spool', 'feedback.jsonl'),
  };
}
