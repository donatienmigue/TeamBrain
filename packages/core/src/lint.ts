import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryFile, FrontmatterParseError } from './frontmatter.js';
import { parseBrainConfig, BrainConfigParseError } from './brain-config.js';
import { MEMORY_CLASS_DIRECTORIES, type MemoryFrontmatter } from './memory.js';
import { scanForInjection } from './injection-patterns.js';

export const MAX_BODY_WORDS = 400;

export type LintRule =
  'schema' | 'body' | 'evidence' | 'injection' | 'placement';

export interface LintViolation {
  /** Path relative to the brain root, forward slashes. */
  file: string;
  rule: LintRule;
  message: string;
}

export interface LintOptions {
  /**
   * Fail memories that cite no evidence. C1 makes evidence mandatory for
   * distiller-proposed memories but carries no proposer field, so the
   * distill PR check (M6.4) opts in via this flag; the default only
   * rejects evidence blocks that are present but empty.
   */
  requireEvidence?: boolean;
}

export interface BrainLintReport {
  memoryFileCount: number;
  violations: LintViolation[];
}

function checkPlacement(
  file: string,
  frontmatter: MemoryFrontmatter,
): LintViolation[] {
  const violations: LintViolation[] = [];
  const segments = file.split('/');
  const filename = segments[segments.length - 1] ?? file;

  if (!filename.startsWith(`${frontmatter.id}-`)) {
    violations.push({
      file,
      rule: 'placement',
      message: `filename does not start with the front-matter id ${frontmatter.id}`,
    });
  }

  // Locate the brain-layout root segment so single-file lints with a
  // longer prefix (e.g. testdata/brains/valid/memories/...) still check.
  const memoriesIndex = segments.lastIndexOf('memories');
  const retiredIndex = segments.lastIndexOf('retired');

  if (memoriesIndex !== -1 && memoriesIndex > retiredIndex) {
    const expectedDir = MEMORY_CLASS_DIRECTORIES[frontmatter.class];
    if (segments[memoriesIndex + 1] !== expectedDir) {
      violations.push({
        file,
        rule: 'placement',
        message: `class ${frontmatter.class} belongs in memories/${expectedDir}/`,
      });
    }
    if (frontmatter.status !== 'active') {
      violations.push({
        file,
        rule: 'placement',
        message: 'retired memories belong in retired/ (C1)',
      });
    }
  } else if (retiredIndex !== -1) {
    if (frontmatter.status !== 'retired') {
      violations.push({
        file,
        rule: 'placement',
        message: 'memories in retired/ must have status: retired (C1)',
      });
    }
  }

  return violations;
}

/** Lints one memory file's text. `file` is used for placement checks. */
export function lintMemoryText(
  file: string,
  fileText: string,
  options: LintOptions = {},
): LintViolation[] {
  const violations: LintViolation[] = [];

  let frontmatter: MemoryFrontmatter;
  let body: string;
  try {
    ({ frontmatter, body } = parseMemoryFile(fileText));
  } catch (err) {
    if (err instanceof FrontmatterParseError) {
      // Unparseable files get exactly one violation; the remaining
      // rules need parsed front-matter to say anything meaningful.
      return [{ file, rule: 'schema', message: err.message }];
    }
    throw err;
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_BODY_WORDS) {
    violations.push({
      file,
      rule: 'body',
      message: `body is ${wordCount} words (hard limit ${MAX_BODY_WORDS})`,
    });
  }

  const { evidence } = frontmatter;
  if (
    evidence !== undefined &&
    evidence.sessions.length === 0 &&
    evidence.commits.length === 0
  ) {
    violations.push({
      file,
      rule: 'evidence',
      message: 'evidence block is present but cites no sessions or commits',
    });
  } else if (options.requireEvidence && evidence === undefined) {
    violations.push({
      file,
      rule: 'evidence',
      message: 'evidence is required (distilled memories must cite sources)',
    });
  }

  for (const finding of scanForInjection(body)) {
    violations.push({
      file,
      rule: 'injection',
      message: `body matches injection pattern "${finding.patternId}": "${finding.excerpt}"`,
    });
  }

  violations.push(...checkPlacement(file, frontmatter));
  return violations;
}

function* walkMarkdownFiles(
  absoluteDir: string,
  relativeDir: string,
): Generator<string> {
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(join(absoluteDir, entry.name), relativePath);
    } else if (entry.name.endsWith('.md')) {
      yield relativePath;
    }
  }
}

/** Lints a brain directory: brain.yaml plus memories/ and retired/. */
export function lintBrain(
  brainDir: string,
  options: LintOptions = {},
): BrainLintReport {
  const violations: LintViolation[] = [];
  let memoryFileCount = 0;

  const brainYamlPath = join(brainDir, 'brain.yaml');
  if (existsSync(brainYamlPath)) {
    try {
      parseBrainConfig(readFileSync(brainYamlPath, 'utf8'));
    } catch (err) {
      if (!(err instanceof BrainConfigParseError)) throw err;
      violations.push({
        file: 'brain.yaml',
        rule: 'schema',
        message: err.message,
      });
    }
  } else {
    violations.push({
      file: 'brain.yaml',
      rule: 'schema',
      message: 'brain.yaml is missing (C7 brain layout)',
    });
  }

  for (const layoutRoot of ['memories', 'retired']) {
    const rootDir = join(brainDir, layoutRoot);
    if (!existsSync(rootDir)) continue;
    for (const relativePath of walkMarkdownFiles(rootDir, layoutRoot)) {
      memoryFileCount += 1;
      const fileText = readFileSync(join(brainDir, relativePath), 'utf8');
      violations.push(...lintMemoryText(relativePath, fileText, options));
    }
  }

  return { memoryFileCount, violations };
}
