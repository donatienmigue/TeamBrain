import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryJsonSchema, sessionEventJsonSchema } from './schemas.js';
import {
  validateBrain,
  validateEventLine,
  validateMemoryText,
} from './validate.js';

// E6.2: the conformance corpus is testdata/compat/v1-brain/ — PROMOTED from the
// internal fixture, never regenerated (its byte-exactness is separately gated by
// core/compat-v1.test.ts). The validator must accept it and reject a one-byte
// perturbation.

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const COMPAT_BRAIN = join(REPO_ROOT, 'testdata', 'compat', 'v1-brain');
const A_MEMORY = join(
  COMPAT_BRAIN,
  'memories',
  'conventions',
  '01JZCP1B2C3D4E5F6G7H8J9KAM-validate-external-input-with-zod-at-every-bounda.md',
);

describe('conformance validator', () => {
  it('accepts the promoted compat brain', () => {
    const result = validateBrain(COMPAT_BRAIN);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
  });

  it('rejects a one-byte perturbation of a conformance memory', () => {
    const valid = readFileSync(A_MEMORY, 'utf8');
    expect(validateMemoryText(valid)).toBeNull();
    // One byte: status "active" → "activi" (not a valid enum value).
    const perturbed = valid.replace('status: active', 'status: activi');
    expect(perturbed).not.toBe(valid);
    expect(validateMemoryText(perturbed)).not.toBeNull();
  });

  it('rejects a malformed session event', () => {
    const valid =
      '{"v":1,"sid":"s1","t":"2026-07-05T09:00:00.000Z","tool":"claude-code","model":"m","repo":"r","branch":"b","ev":"session_start","data":{}}';
    expect(validateEventLine(valid)).toBeNull();
    // Drop the required `sid`.
    const broken = valid.replace('"sid":"s1",', '');
    expect(validateEventLine(broken)).not.toBeNull();
  });

  it('exports derived JSON Schema for C1 and C2', () => {
    expect(memoryJsonSchema()).toBeTypeOf('object');
    expect(sessionEventJsonSchema()).toBeTypeOf('object');
  });
});
