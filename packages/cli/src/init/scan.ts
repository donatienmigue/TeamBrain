import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UserError, slugify } from '@teambrain/core';

// M2.1 scanner: finds agent-facing knowledge already in a repo. Pure
// read — importing never writes to the scanned repo.

export type SourceKind =
  | 'claude-md'
  | 'agents-md'
  | 'cursorrules'
  | 'cursor-rule'
  | 'adr'
  | 'readme-arch';

export interface ScannedSource {
  /** Repo-relative path, forward slashes (README sections get #slug). */
  path: string;
  kind: SourceKind;
  /** The text eligible for import (mdc frontmatter already stripped). */
  text: string;
  /** Preferred title when the text itself has no usable heading. */
  titleHint?: string;
}

// README sections with these words in the heading are treated as
// architecture knowledge (class map); everything else in a README is
// human onboarding text, not memory material.
const README_ARCH_HEADING =
  /architect|structure|service|component|system overview/i;

function readTextFile(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

/** Splits `.mdc` frontmatter off; returns the body and a description. */
function stripMdcFrontmatter(text: string): {
  body: string;
  description?: string;
} {
  if (!text.startsWith('---\n')) return { body: text };
  const closingFence = text.indexOf('\n---\n', 3);
  if (closingFence === -1) return { body: text };
  const frontmatter = text.slice(4, closingFence);
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  return {
    body: text.slice(closingFence + 5).replace(/^\n+/, ''),
    ...(description !== undefined && { description }),
  };
}

interface ReadmeSection {
  heading: string;
  text: string;
}

/** Extracts `## `-sections of a README whose heading looks architectural. */
function extractArchSections(readmeText: string): ReadmeSection[] {
  const sections: ReadmeSection[] = [];
  const parts = readmeText.split(/^(?=## )/m);
  for (const part of parts) {
    const headingMatch = /^## (.+)\n/.exec(part);
    const heading = headingMatch?.[1]?.trim();
    if (heading !== undefined && README_ARCH_HEADING.test(heading)) {
      sections.push({ heading, text: part.trimEnd() });
    }
  }
  return sections;
}

export function scanRepo(repoDir: string): ScannedSource[] {
  if (!existsSync(repoDir) || !statSync(repoDir).isDirectory()) {
    throw new UserError(`not a directory: ${repoDir}`);
  }
  const sources: ScannedSource[] = [];

  const addFile = (relativePath: string, kind: SourceKind): void => {
    const filePath = join(repoDir, relativePath);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return;
    sources.push({ path: relativePath, kind, text: readTextFile(filePath) });
  };

  addFile('CLAUDE.md', 'claude-md');
  addFile('AGENTS.md', 'agents-md');
  addFile('.cursorrules', 'cursorrules');

  const cursorRulesDir = join(repoDir, '.cursor', 'rules');
  if (existsSync(cursorRulesDir) && statSync(cursorRulesDir).isDirectory()) {
    for (const name of readdirSync(cursorRulesDir).sort()) {
      const filePath = join(cursorRulesDir, name);
      if (!statSync(filePath).isFile()) continue;
      const { body, description } = stripMdcFrontmatter(readTextFile(filePath));
      sources.push({
        path: `.cursor/rules/${name}`,
        kind: 'cursor-rule',
        text: body,
        ...(description !== undefined && { titleHint: description }),
      });
    }
  }

  const adrDir = join(repoDir, 'docs', 'adr');
  if (existsSync(adrDir) && statSync(adrDir).isDirectory()) {
    for (const name of readdirSync(adrDir).sort()) {
      const filePath = join(adrDir, name);
      if (!statSync(filePath).isFile() || !name.endsWith('.md')) continue;
      sources.push({
        path: `docs/adr/${name}`,
        kind: 'adr',
        text: readTextFile(filePath),
      });
    }
  }

  const readmePath = join(repoDir, 'README.md');
  if (existsSync(readmePath) && statSync(readmePath).isFile()) {
    for (const section of extractArchSections(readTextFile(readmePath))) {
      sources.push({
        path: `README.md#${slugify(section.heading)}`,
        kind: 'readme-arch',
        text: section.text,
        titleHint: section.heading,
      });
    }
  }

  return sources;
}
