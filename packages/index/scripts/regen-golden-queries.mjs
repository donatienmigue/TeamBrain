// Regenerates testdata/golden-queries.yaml from the deterministic synthetic
// brain generator. Run after intentionally changing the generator or the
// golden topics: `pnpm --filter @teambrain/index build && node packages/index/scripts/regen-golden-queries.mjs`
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOLDEN_TOPICS,
  SYNTHETIC_COUNT,
  SYNTHETIC_SEED,
  generateSyntheticBrain,
} from '../dist/synthetic.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outPath = join(repoRoot, 'testdata', 'golden-queries.yaml');

const { goldenIds } = generateSyntheticBrain();
let yaml =
  '# M3.4 golden query set: 25 query -> expected-id pairs over the\n' +
  '# deterministic synthetic brain (packages/index/src/synthetic.ts).\n' +
  '# Regenerate via: node packages/index/scripts/regen-golden-queries.mjs\n' +
  `seed: ${SYNTHETIC_SEED}\ncount: ${SYNTHETIC_COUNT}\nqueries:\n`;
for (const topic of GOLDEN_TOPICS) {
  const id = goldenIds[topic.key];
  if (id === undefined) {
    throw new Error(`generator produced no memory for topic ${topic.key}`);
  }
  yaml += `  - key: ${topic.key}\n    query: ${JSON.stringify(topic.query)}\n    expected_id: ${id}\n`;
}
writeFileSync(outPath, yaml, 'utf8');
console.log(`wrote ${GOLDEN_TOPICS.length} golden queries to ${outPath}`);
