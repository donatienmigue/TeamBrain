import { SECRET_RULES } from './secrets.js';
import { PII_RULES } from './pii.js';
import { redactHighEntropy } from './entropy.js';

// M5.1 redaction orchestration. Order: named secrets → high-entropy tokens →
// PII (strict only). Replacements are typed `«REDACTED:type»` so the
// distiller keeps the signal (there was an aws_key here) without the content,
// and `tb audit` can summarize "2 aws_key, 1 email". Pure and dependency-free
// so the hook path can call it inside its 20ms budget.

export type RedactionLevel = 'strict' | 'standard';

const MARKER_OPEN = '«REDACTED:';
const MARKER_CLOSE = '»';

export function redactionMarker(type: string): string {
  return `${MARKER_OPEN}${type}${MARKER_CLOSE}`;
}

export interface RedactionResult {
  text: string;
  /** One entry per replacement, in detector order; may contain duplicates. */
  replacements: string[];
}

/**
 * Redacts a single string. At `standard` level PII detectors are skipped
 * (secrets and high-entropy tokens are always scrubbed).
 */
export function redactString(
  text: string,
  level: RedactionLevel = 'strict',
): RedactionResult {
  const replacements: string[] = [];
  let out = text;

  for (const rule of SECRET_RULES) {
    out = out.replace(rule.regex, () => {
      replacements.push(rule.type);
      return redactionMarker(rule.type);
    });
  }

  out = redactHighEntropy(out, () => {
    replacements.push('high_entropy');
    return redactionMarker('high_entropy');
  });

  if (level === 'strict') {
    for (const rule of PII_RULES) {
      out = out.replace(rule.regex, () => {
        replacements.push(rule.type);
        return redactionMarker(rule.type);
      });
    }
  }

  return { text: out, replacements };
}

export interface RedactionValueResult<T> {
  value: T;
  replacements: string[];
}

/**
 * Deep-redacts every string leaf of a JSON-ish value, returning a new value
 * (input is never mutated) and the combined replacement list. Object keys are
 * left intact — only values are scrubbed.
 */
export function redactValue<T>(
  value: T,
  level: RedactionLevel = 'strict',
): RedactionValueResult<T> {
  const replacements: string[] = [];
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const result = redactString(node, level);
      replacements.push(...result.replacements);
      return result.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) {
        out[key] = walk(entry);
      }
      return out;
    }
    return node;
  };
  return { value: walk(value) as T, replacements };
}

/** Rolls a replacement list into `{ type: count }` for audit summaries. */
export function summarizeReplacements(
  replacements: string[],
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const type of replacements) {
    summary[type] = (summary[type] ?? 0) + 1;
  }
  return summary;
}

const MARKER_REGEX = /«REDACTED:([^»]+)»/g;

/**
 * Counts `«REDACTED:type»` markers already present in text (e.g. a stored
 * session record), grouped by type — the basis for `tb audit`'s redaction
 * summary line.
 */
export function countRedactionMarkers(text: string): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const match of text.matchAll(MARKER_REGEX)) {
    const type = match[1] as string;
    summary[type] = (summary[type] ?? 0) + 1;
  }
  return summary;
}
