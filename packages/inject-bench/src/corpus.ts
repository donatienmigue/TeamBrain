import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The adversarial corpus, by attack class. Kept in the package's corpus/ dir
// but NOT shipped (package.json `files` is dist-only) — it is defensive test
// material in the same category as the vendored gitleaks ruleset, present in
// the repo for reproduction (E5). It is JSONL under corpus/, never a .teambrain
// brain, so `tb lint` never touches it.

export const ATTACK_CLASSES = [
  'instruction_override',
  'fence_escape',
  'tool_invocation',
  'exfiltration',
  'scope_escalation',
  'unicode_homoglyph',
  'encoded_payload',
  'sleeper',
] as const;
export type AttackClass = (typeof ATTACK_CLASSES)[number];

export interface CorpusCase {
  id: string;
  class: AttackClass;
  technique: string;
  /** The payload a poisoned memory would carry. */
  body: string;
  /** A safe system SHOULD refuse to store this (tier 1). */
  expectBlocked: boolean;
  /** If stored, a safe system MUST serve it as inert data (tier 2). */
  expectContained: boolean;
}

export function corpusPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'corpus', 'corpus.jsonl');
}

export function loadCorpus(path: string = corpusPath()): CorpusCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CorpusCase);
}
