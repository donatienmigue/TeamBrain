import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  memoryFrontmatterSchema,
  type Memory,
  type MemoryFrontmatter,
} from './memory.js';

export class FrontmatterParseError extends Error {
  override readonly name = 'FrontmatterParseError';
}

export interface ParsedMemoryFile {
  frontmatter: MemoryFrontmatter;
  body: string;
}

// YAML 1.2 core-schema keywords plus legacy 1.1 booleans; quoted defensively.
const RESERVED_SCALARS = new Set([
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
const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function scalarString(value: string): string {
  const plainSafe =
    PLAIN_SCALAR.test(value) &&
    !/^\d+$/.test(value) &&
    !RESERVED_SCALARS.has(value.toLowerCase());
  return plainSafe ? value : JSON.stringify(value);
}

function stringList(
  key: string,
  items: readonly string[],
  indent: string,
): string {
  if (items.length === 0) return `${indent}${key}: []\n`;
  let out = `${indent}${key}:\n`;
  for (const item of items) {
    out += `${indent}  - ${scalarString(item)}\n`;
  }
  return out;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Canonical serialization: fields in C1 contract order, JSON-quoted title,
 * block-style lists (`[]` when empty), `---` fences, one blank line before
 * the body, exactly one trailing newline. Byte-exact round-trip is
 * guaranteed for files in this form.
 */
export function serializeMemoryFile(memory: Memory): string {
  const { body, ...rest } = memory;
  const fm = memoryFrontmatterSchema.parse(rest);
  let out = '---\n';
  out += `id: ${fm.id}\n`;
  out += `class: ${fm.class}\n`;
  out += `scope: ${fm.scope}\n`;
  out += `status: ${fm.status}\n`;
  out += `priority: ${fm.priority}\n`;
  out += `title: ${JSON.stringify(fm.title)}\n`;
  out += `created: ${fm.created}\n`;
  if (fm.evidence) {
    out += 'evidence:\n';
    out += stringList('sessions', fm.evidence.sessions, '  ');
    out += stringList('commits', fm.evidence.commits, '  ');
  }
  out += stringList('supersedes', fm.supersedes, '');
  out += stringList('tags', fm.tags, '');
  out += `ttl_days: ${fm.ttl_days === null ? 'null' : String(fm.ttl_days)}\n`;
  out += '---\n\n';
  return out + body.replace(/\n+$/, '') + '\n';
}

export function parseMemoryFile(text: string): ParsedMemoryFile {
  if (text.includes('\r')) {
    throw new FrontmatterParseError(
      'memory files must use LF line endings (found CR)',
    );
  }
  if (!text.startsWith('---\n')) {
    throw new FrontmatterParseError('missing opening front-matter fence');
  }
  const fenceEnd = text.indexOf('\n---\n', 3);
  if (fenceEnd === -1) {
    throw new FrontmatterParseError('missing closing front-matter fence');
  }
  const yamlBlock = text.slice(4, fenceEnd + 1);
  const rest = text.slice(fenceEnd + 5);

  let raw: unknown;
  try {
    raw = parseYaml(yamlBlock);
  } catch (err) {
    throw new FrontmatterParseError(
      `invalid front-matter YAML: ${(err as Error).message}`,
      {
        cause: err,
      },
    );
  }
  const result = memoryFrontmatterSchema.safeParse(raw);
  if (!result.success) {
    throw new FrontmatterParseError(
      `invalid front-matter: ${formatIssues(result.error)}`,
      {
        cause: result.error,
      },
    );
  }

  const body = rest.replace(/^\n+/, '').replace(/\n+$/, '');
  return { frontmatter: result.data, body };
}
