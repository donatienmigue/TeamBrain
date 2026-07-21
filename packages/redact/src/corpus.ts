import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The public, release-gating redaction corpus (M5.1). Shipped in the package
// (`files` includes `corpus/`) so `tb verify` V4 can run it against the
// INSTALLED redactor, not just the repo's tests. One loader, used by both
// corpus.test.ts and the verifier, so the two can never diverge.

export interface RedactionCorpusCase {
  id: string;
  kind: 'positive' | 'negative';
  detector?: string;
  input: string;
  expect_types?: string[];
  secret?: string;
  note?: string;
}

// Some detector prefixes match live-credential formats that GitHub's push
// protection blocks on sight — a redaction *test* corpus can't win that fight.
// So those fixtures are stored "de-fanged" (the prefix as a `{token}`
// placeholder) and the real prefix is re-assembled here at load time. The
// committed bytes never form a scannable credential; the engine still sees the
// genuine format. See corpus/README.md.
const DEFANG: Record<string, string> = {
  '{glpat}': 'glpat-',
  '{sk_live}': 'sk_live_',
  '{rk_live}': 'rk_live_',
};

function refang(value: string): string {
  let out = value;
  for (const [placeholder, prefix] of Object.entries(DEFANG)) {
    out = out.split(placeholder).join(prefix);
  }
  return out;
}

/** Absolute path to the shipped corpus file (dev: src/../corpus; dist: ../corpus). */
export function redactionCorpusPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'corpus', 'corpus.jsonl');
}

export function loadRedactionCorpus(): RedactionCorpusCase[] {
  return readFileSync(redactionCorpusPath(), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as RedactionCorpusCase;
      parsed.input = refang(parsed.input);
      if (parsed.secret !== undefined) parsed.secret = refang(parsed.secret);
      return parsed;
    });
}
