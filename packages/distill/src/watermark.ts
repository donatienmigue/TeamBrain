import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';

// M6.1 distill watermark: the point on `teambrain/sessions` already distilled.
// Stored in a `state.distill` block in `.teambrain/brain.yaml`, written by the
// CI commit that advances the run. Reading it bounds "new records since last
// run"; writing it is done after a successful cycle (M6.4 / CI).

const WATERMARK_PATH = ['state', 'distill', 'watermark'] as const;
const UPDATED_PATH = ['state', 'distill', 'updated_at'] as const;

function brainConfigPath(brainDir: string): string {
  return join(brainDir, 'brain.yaml');
}

/** The last distilled sessions-branch SHA, or null on first run / no state. */
export function readDistillWatermark(brainDir: string): string | null {
  const path = brainConfigPath(brainDir);
  if (!existsSync(path)) return null;
  const parsed = parse(readFileSync(path, 'utf8')) as
    { state?: { distill?: { watermark?: unknown } } } | null | undefined;
  const watermark = parsed?.state?.distill?.watermark;
  return typeof watermark === 'string' && watermark.length > 0
    ? watermark
    : null;
}

/**
 * Advances the watermark in place, preserving the file's other keys, comments,
 * and formatting (a document round-trip, not a re-serialize). This is the CI
 * commit's write; the collect+cluster stage only reads.
 */
export function writeDistillWatermark(
  brainDir: string,
  watermark: string,
  now: Date = new Date(),
): void {
  const path = brainConfigPath(brainDir);
  const doc = existsSync(path)
    ? parseDocument(readFileSync(path, 'utf8'))
    : parseDocument('version: 1\n');
  doc.setIn([...WATERMARK_PATH], watermark);
  doc.setIn([...UPDATED_PATH], now.toISOString());
  writeFileSync(path, doc.toString(), 'utf8');
}
