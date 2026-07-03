import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserError } from '@teambrain/core';
import { scanRepo } from './scan.js';

const REPOS_DIR = fileURLToPath(
  new URL('../../../../testdata/repos', import.meta.url),
);

describe('scanRepo', () => {
  it('throws a UserError (exit 1) for a missing directory', () => {
    expect(() => scanRepo(join(REPOS_DIR, 'no-such-repo'))).toThrow(UserError);
  });

  it('claude-md-only: finds CLAUDE.md and ignores the plain README', () => {
    const sources = scanRepo(join(REPOS_DIR, 'claude-md-only'));
    expect(sources.map((s) => [s.kind, s.path])).toEqual([
      ['claude-md', 'CLAUDE.md'],
    ]);
  });

  it('cursor-heavy: finds all cursor surfaces plus the README arch section', () => {
    const sources = scanRepo(join(REPOS_DIR, 'cursor-heavy'));
    expect(sources.map((s) => [s.kind, s.path])).toEqual([
      ['agents-md', 'AGENTS.md'],
      ['cursorrules', '.cursorrules'],
      ['cursor-rule', '.cursor/rules/testing.mdc'],
      ['cursor-rule', '.cursor/rules/typescript.mdc'],
      ['readme-arch', 'README.md#architecture'],
    ]);
  });

  it('strips mdc frontmatter and keeps its description as a title hint', () => {
    const sources = scanRepo(join(REPOS_DIR, 'cursor-heavy'));
    const typescriptRule = sources.find((s) =>
      s.path.endsWith('typescript.mdc'),
    );
    expect(typescriptRule?.titleHint).toBe(
      'TypeScript conventions for the storefront',
    );
    expect(typescriptRule?.text).not.toContain('globs:');
    expect(typescriptRule?.text).toContain('Use type-only imports');

    const bareRule = sources.find((s) => s.path.endsWith('testing.mdc'));
    expect(bareRule?.titleHint).toBeUndefined();
    expect(bareRule?.text).toContain('Component tests use Testing Library');
  });

  it('readme-arch sections carry the heading as title hint and full text', () => {
    const sources = scanRepo(join(REPOS_DIR, 'cursor-heavy'));
    const archSection = sources.find((s) => s.kind === 'readme-arch');
    expect(archSection?.titleHint).toBe('Architecture');
    expect(archSection?.text).toContain('## Architecture');
    expect(archSection?.text).toContain('Meilisearch');
    expect(archSection?.text).not.toContain('CONTRIBUTING.md');
  });

  it('adr-rich: finds every ADR in order plus the sectionless CLAUDE.md', () => {
    const sources = scanRepo(join(REPOS_DIR, 'adr-rich'));
    expect(sources.map((s) => [s.kind, s.path])).toEqual([
      ['claude-md', 'CLAUDE.md'],
      ['adr', 'docs/adr/0001-use-postgres-for-transactional-data.md'],
      ['adr', 'docs/adr/0002-adopt-event-driven-integration.md'],
      ['adr', 'docs/adr/0003-split-the-monolith-into-workspaces.md'],
    ]);
  });
});
