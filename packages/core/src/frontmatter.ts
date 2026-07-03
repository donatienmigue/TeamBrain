import { parse as parseYaml } from 'yaml';
import {
  memoryFrontmatterSchema,
  type Memory,
  type MemoryFrontmatter,
} from './memory.js';
import { formatZodIssues } from './zod-issues.js';

export class FrontmatterParseError extends Error {
  override readonly name = 'FrontmatterParseError';
}

export interface ParsedMemoryFile {
  frontmatter: MemoryFrontmatter;
  body: string;
}

// YAML 1.2 core-schema keywords plus legacy 1.1 booleans; quoted defensively.
const YAML_RESERVED_WORDS = new Set([
  'true',
  'false',
  'null',
  'yes',
  'no',
  'on',
  'off',
  'nan',
  'inf',
]);
const YAML_PLAIN_SCALAR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Emits a string as a YAML scalar, quoting whenever plain style is unsafe. */
function toYamlScalar(value: string): string {
  const plainStyleIsSafe =
    YAML_PLAIN_SCALAR_PATTERN.test(value) &&
    !/^\d+$/.test(value) &&
    !YAML_RESERVED_WORDS.has(value.toLowerCase());
  return plainStyleIsSafe ? value : JSON.stringify(value);
}

/** Emits a `key: []` or block-style YAML list of string scalars. */
function toYamlStringList(
  key: string,
  items: readonly string[],
  indent: string,
): string {
  if (items.length === 0) return `${indent}${key}: []\n`;
  let block = `${indent}${key}:\n`;
  for (const item of items) {
    block += `${indent}  - ${toYamlScalar(item)}\n`;
  }
  return block;
}

/**
 * Canonical serialization: fields in C1 contract order, JSON-quoted title,
 * block-style lists (`[]` when empty), `---` fences, one blank line before
 * the body, exactly one trailing newline. Byte-exact round-trip is
 * guaranteed for files in this form.
 */
export function serializeMemoryFile(memory: Memory): string {
  const { body, ...frontmatterFields } = memory;
  const frontmatter = memoryFrontmatterSchema.parse(frontmatterFields);
  let fileText = '---\n';
  fileText += `id: ${frontmatter.id}\n`;
  fileText += `class: ${frontmatter.class}\n`;
  fileText += `scope: ${frontmatter.scope}\n`;
  fileText += `status: ${frontmatter.status}\n`;
  fileText += `priority: ${frontmatter.priority}\n`;
  fileText += `title: ${JSON.stringify(frontmatter.title)}\n`;
  fileText += `created: ${frontmatter.created}\n`;
  if (frontmatter.evidence) {
    fileText += 'evidence:\n';
    fileText += toYamlStringList(
      'sessions',
      frontmatter.evidence.sessions,
      '  ',
    );
    fileText += toYamlStringList('commits', frontmatter.evidence.commits, '  ');
  }
  fileText += toYamlStringList('supersedes', frontmatter.supersedes, '');
  fileText += toYamlStringList('tags', frontmatter.tags, '');
  fileText += `ttl_days: ${frontmatter.ttl_days === null ? 'null' : String(frontmatter.ttl_days)}\n`;
  fileText += '---\n\n';
  return fileText + body.replace(/\n+$/, '') + '\n';
}

export function parseMemoryFile(fileText: string): ParsedMemoryFile {
  if (fileText.includes('\r')) {
    throw new FrontmatterParseError(
      'memory files must use LF line endings (found CR)',
    );
  }
  if (!fileText.startsWith('---\n')) {
    throw new FrontmatterParseError('missing opening front-matter fence');
  }
  const closingFenceIndex = fileText.indexOf('\n---\n', 3);
  if (closingFenceIndex === -1) {
    throw new FrontmatterParseError('missing closing front-matter fence');
  }
  const yamlBlock = fileText.slice(4, closingFenceIndex + 1);
  const afterClosingFence = fileText.slice(closingFenceIndex + 5);

  let yamlData: unknown;
  try {
    yamlData = parseYaml(yamlBlock);
  } catch (err) {
    throw new FrontmatterParseError(
      `invalid front-matter YAML: ${(err as Error).message}`,
      { cause: err },
    );
  }
  const validation = memoryFrontmatterSchema.safeParse(yamlData);
  if (!validation.success) {
    throw new FrontmatterParseError(
      `invalid front-matter: ${formatZodIssues(validation.error)}`,
      { cause: validation.error },
    );
  }

  const body = afterClosingFence.replace(/^\n+/, '').replace(/\n+$/, '');
  return { frontmatter: validation.data, body };
}
