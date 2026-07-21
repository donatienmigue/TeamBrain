import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryFile } from '@teambrain/core';
import { sessionEventSchema } from './schemas.js';

// E6.2: a conformance validator that reuses the product's canonical parser and
// schemas, so a PASS here means the same thing the product means. Standalone in
// the sense that matters — no daemon, no index, no network — just the schemas.

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  checked: number;
  errors: ValidationError[];
}

export function validateMemoryText(text: string): string | null {
  try {
    parseMemoryFile(text);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export function validateEventLine(line: string): string | null {
  try {
    sessionEventSchema.parse(JSON.parse(line));
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

function walkFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Validates a brain directory (memories/, retired/, sessions/) for conformance. */
export function validateBrain(brainDir: string): ValidationResult {
  const errors: ValidationError[] = [];
  let checked = 0;

  for (const sub of ['memories', 'retired']) {
    for (const file of walkFiles(join(brainDir, sub), '.md')) {
      checked += 1;
      const message = validateMemoryText(readFileSync(file, 'utf8'));
      if (message !== null) errors.push({ path: file, message });
    }
  }

  for (const file of walkFiles(join(brainDir, 'sessions'), '.jsonl')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.trim() === '') continue;
      checked += 1;
      const message = validateEventLine(line);
      if (message !== null) {
        errors.push({ path: `${file}:${i + 1}`, message });
      }
    }
  }

  return { ok: errors.length === 0, checked, errors };
}
