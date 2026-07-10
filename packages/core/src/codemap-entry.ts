import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { ValidationError } from './errors.js';
import { formatZodIssues } from './zod-issues.js';

// R16 CodeMap entry file (Tech Brief §4.8): one machine-generated summary per
// source file, written under `.teambrain/codemap/files/<repo-path>.md`.
// Derived artifact — regenerable, indexed directly, never PR-gated. The
// format is deliberately tiny and byte-stable (serialize(parse(x)) === x)
// so incremental runs only rewrite entries whose content actually changed.

export const codemapEntrySchema = z.object({
  v: z.literal(1),
  /** Repo-relative posix path of the summarized source file. */
  path: z.string().min(1),
  /** sha256 (hex) of the source file bytes this summary was generated from. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** ISO date (YYYY-MM-DD) the summary was (re)generated. */
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CodemapEntryFrontmatter = z.infer<typeof codemapEntrySchema>;

export interface ParsedCodemapEntry {
  frontmatter: CodemapEntryFrontmatter;
  /** The summary markdown, without surrounding blank lines. */
  body: string;
}

export class CodemapEntryParseError extends ValidationError {
  override readonly name = 'CodemapEntryParseError';
}

const DELIMITER = '---';

export function serializeCodemapEntry(entry: ParsedCodemapEntry): string {
  const { frontmatter, body } = entry;
  return [
    DELIMITER,
    `v: ${frontmatter.v}`,
    // path may contain YAML-hostile characters; always quote.
    `path: ${JSON.stringify(frontmatter.path)}`,
    `hash: ${frontmatter.hash}`,
    `updated: ${JSON.stringify(frontmatter.updated)}`,
    DELIMITER,
    '',
    `${body.trim()}`,
    '',
  ].join('\n');
}

export function parseCodemapEntry(fileText: string): ParsedCodemapEntry {
  const normalized = fileText.replace(/\r\n/g, '\n');
  if (!normalized.startsWith(`${DELIMITER}\n`)) {
    throw new CodemapEntryParseError(
      'codemap entry must start with a --- front-matter block',
    );
  }
  const end = normalized.indexOf(`\n${DELIMITER}\n`, DELIMITER.length);
  if (end === -1) {
    throw new CodemapEntryParseError('unterminated front-matter block');
  }
  const yamlText = normalized.slice(DELIMITER.length + 1, end);
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new CodemapEntryParseError(
      `invalid front-matter YAML: ${(err as Error).message}`,
      { cause: err },
    );
  }
  const validation = codemapEntrySchema.safeParse(raw);
  if (!validation.success) {
    throw new CodemapEntryParseError(
      `invalid codemap entry: ${formatZodIssues(validation.error)}`,
      { cause: validation.error },
    );
  }
  const body = normalized.slice(end + DELIMITER.length + 2).trim();
  return { frontmatter: validation.data, body };
}
