import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FrontmatterParseError,
  parseMemoryFile,
  serializeMemoryFile,
} from './frontmatter.js';
import { ulid } from './ulid.js';
import type { Memory } from './memory.js';

const corpusDir = fileURLToPath(
  new URL('../testdata/memories/', import.meta.url),
);

const corpusFiles = readdirSync(corpusDir, {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();

describe('fixture corpus round-trip', () => {
  it('has at least 12 fixtures', () => {
    expect(corpusFiles.length).toBeGreaterThanOrEqual(12);
  });

  it.each(corpusFiles.map((file) => [file.slice(corpusDir.length), file]))(
    'round-trips %s byte-exactly',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      const { frontmatter, body } = parseMemoryFile(text);
      expect(serializeMemoryFile({ ...frontmatter, body })).toBe(text);
    },
  );

  it('covers all classes, retired, TTL, supersedes, evidence, org scope, required priority', () => {
    const parsedFiles = corpusFiles.map((file) =>
      parseMemoryFile(readFileSync(file, 'utf8')),
    );
    const classes = new Set(parsedFiles.map((file) => file.frontmatter.class));
    expect(classes).toEqual(
      new Set(['decision', 'convention', 'map', 'learning']),
    );
    const frontmatters = parsedFiles.map((file) => file.frontmatter);
    expect(frontmatters.some((entry) => entry.status === 'retired')).toBe(true);
    expect(frontmatters.some((entry) => entry.ttl_days !== null)).toBe(true);
    expect(frontmatters.some((entry) => entry.supersedes.length > 0)).toBe(
      true,
    );
    expect(frontmatters.some((entry) => entry.evidence !== undefined)).toBe(
      true,
    );
    expect(frontmatters.some((entry) => entry.scope === 'org')).toBe(true);
    expect(frontmatters.some((entry) => entry.priority === 'required')).toBe(
      true,
    );
  });
});

describe('serialize → parse round-trip on generated memories', () => {
  const cases: Array<[string, Memory]> = [
    [
      'minimal memory',
      {
        id: ulid(),
        class: 'learning',
        scope: 'team',
        status: 'active',
        priority: 'advisory',
        title: 'Plain title',
        created: '2026-07-03',
        supersedes: [],
        tags: [],
        ttl_days: null,
        body: 'One line body.',
      },
    ],
    [
      'title needing YAML escaping',
      {
        id: ulid(),
        class: 'convention',
        scope: 'org',
        status: 'active',
        priority: 'required',
        title: 'Quote "everything": colons, #hashes — and unicode é',
        created: '2026-01-31',
        evidence: { sessions: [`s_${ulid()}`], commits: ['a1b2c3d'] },
        supersedes: [ulid()],
        tags: ['weird tag with spaces', 'true', '123', 'normal-tag'],
        ttl_days: 7,
        body: 'Body with a --- line inside it.\n\n---\n\nStill the body.',
      },
    ],
    [
      'empty body',
      {
        id: ulid(),
        class: 'map',
        scope: 'team',
        status: 'retired',
        priority: 'advisory',
        title: 'Retired map entry',
        created: '2025-12-01',
        supersedes: [],
        tags: ['x'],
        ttl_days: 365,
        body: '',
      },
    ],
  ];

  it.each(cases)('parse(serialize(m)) equals m — %s', (_name, memory) => {
    const text = serializeMemoryFile(memory);
    const { frontmatter, body } = parseMemoryFile(text);
    const { body: originalBody, ...originalFrontmatter } = memory;
    expect(frontmatter).toEqual(originalFrontmatter);
    expect(body).toBe(originalBody.replace(/\n+$/, ''));
    // And serialization of the parse result is stable (canonical fixed point).
    expect(serializeMemoryFile({ ...frontmatter, body })).toBe(text);
  });
});

describe('parseMemoryFile errors', () => {
  it('rejects CRLF input explicitly', () => {
    expect(() =>
      parseMemoryFile('---\r\nid: x\r\n---\r\n\r\nbody\r\n'),
    ).toThrow(FrontmatterParseError);
    expect(() => parseMemoryFile('---\r\n')).toThrow(/LF line endings/);
  });

  it('rejects a missing opening fence', () => {
    expect(() => parseMemoryFile('id: x\n---\n\nbody\n')).toThrow(
      /opening front-matter fence/,
    );
  });

  it('rejects a missing closing fence', () => {
    expect(() => parseMemoryFile('---\nid: x\n')).toThrow(
      /closing front-matter fence/,
    );
  });

  it('rejects invalid YAML', () => {
    expect(() => parseMemoryFile('---\n[unclosed\n---\n\nbody\n')).toThrow(
      /invalid front-matter YAML/,
    );
  });

  it('rejects schema violations with the offending path', () => {
    const valid = serializeMemoryFile({
      id: ulid(),
      class: 'decision',
      scope: 'team',
      status: 'active',
      priority: 'advisory',
      title: 'ok',
      created: '2026-07-03',
      supersedes: [],
      tags: [],
      ttl_days: null,
      body: 'b',
    });
    const badId = valid.replace(/^id: .*$/m, 'id: not-a-ulid');
    expect(() => parseMemoryFile(badId)).toThrow(/id: /);

    const badDate = valid.replace(/^created: .*$/m, 'created: 2026-02-30');
    expect(() => parseMemoryFile(badDate)).toThrow(/created: /);

    const unknownKey = valid.replace('---\n\n', 'proposer: distiller\n---\n\n');
    expect(() => parseMemoryFile(unknownKey)).toThrow(FrontmatterParseError);
  });
});

describe('serializeMemoryFile validation', () => {
  it('rejects front-matter that violates C1 before writing', () => {
    expect(() =>
      serializeMemoryFile({
        id: 'nope',
        class: 'decision',
        scope: 'team',
        status: 'active',
        priority: 'advisory',
        title: 'x',
        created: '2026-07-03',
        supersedes: [],
        tags: [],
        ttl_days: null,
        body: 'b',
      }),
    ).toThrow();

    expect(() =>
      serializeMemoryFile({
        id: ulid(),
        class: 'decision',
        scope: 'team',
        status: 'active',
        priority: 'advisory',
        title: 'x'.repeat(81),
        created: '2026-07-03',
        supersedes: [],
        tags: [],
        ttl_days: null,
        body: 'b',
      }),
    ).toThrow();
  });
});
