import {
  MAX_BODY_WORDS,
  ulid,
  type Memory,
  type MemoryClass,
} from '@teambrain/core';
import { scanRepo, type ScannedSource, type SourceKind } from './scan.js';

// M2.1 importer: turns scanned sources into candidate memories. Bodies
// keep the source text verbatim (headings included) so the >=90%
// preservation guarantee holds structurally; units over the 400-word
// body limit split at paragraph boundaries into part-memories linked by
// their shared source: tag.

const KIND_TO_CLASS: Record<SourceKind, MemoryClass> = {
  'claude-md': 'convention',
  'agents-md': 'convention',
  cursorrules: 'convention',
  'cursor-rule': 'convention',
  adr: 'decision',
  'readme-arch': 'map',
};

// Rule collections (many topics per file) split per ## section; ADRs,
// cursor rule files and README sections are one logical unit each.
const SECTION_SPLIT_KINDS: ReadonlySet<SourceKind> = new Set([
  'claude-md',
  'agents-md',
]);

const MAX_TITLE_LENGTH = 80;

export interface ImportResult {
  sources: ScannedSource[];
  candidates: Memory[];
}

export interface ImportOptions {
  /** Injectable clock; candidates carry created = today. */
  now?: () => Date;
}

interface SourceUnit {
  title: string;
  text: string;
}

function truncateTitle(title: string, reserveChars = 0): string {
  const budget = MAX_TITLE_LENGTH - reserveChars;
  if (title.length <= budget) return title;
  return `${title.slice(0, budget - 1).trimEnd()}…`;
}

function headingTitle(text: string, fallback: string): string {
  const heading = /^#{1,6} (.+)$/m.exec(text)?.[1]?.trim();
  return heading !== undefined && heading.length > 0 ? heading : fallback;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Splits a unit into chunks of at most MAX_BODY_WORDS words. */
function chunkByWords(text: string): string[] {
  if (countWords(text) <= MAX_BODY_WORDS) return [text];
  const chunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentWords = 0;
  const flush = (): void => {
    if (currentParagraphs.length > 0) {
      chunks.push(currentParagraphs.join('\n\n'));
      currentParagraphs = [];
      currentWords = 0;
    }
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    const paragraphWords = countWords(paragraph);
    if (paragraphWords > MAX_BODY_WORDS) {
      // A single oversized paragraph: hard-split on word boundaries.
      flush();
      const words = paragraph.split(/\s+/).filter(Boolean);
      for (let start = 0; start < words.length; start += MAX_BODY_WORDS) {
        chunks.push(words.slice(start, start + MAX_BODY_WORDS).join(' '));
      }
      continue;
    }
    if (currentWords + paragraphWords > MAX_BODY_WORDS) flush();
    currentParagraphs.push(paragraph);
    currentWords += paragraphWords;
  }
  flush();
  return chunks;
}

/** One source, one or more titled units (per ## section where relevant). */
function unitsForSource(source: ScannedSource): SourceUnit[] {
  const fallbackTitle = source.titleHint ?? source.path;
  if (!SECTION_SPLIT_KINDS.has(source.kind)) {
    return [
      { title: headingTitle(source.text, fallbackTitle), text: source.text },
    ];
  }
  const units: SourceUnit[] = [];
  const parts = source.text.split(/^(?=## )/m);
  for (const part of parts) {
    const text = part.trimEnd();
    if (text.trim().length === 0) continue;
    const sectionHeading = /^## (.+)\n?/.exec(text)?.[1]?.trim();
    units.push({
      title: sectionHeading ?? headingTitle(text, fallbackTitle),
      text,
    });
  }
  return units;
}

function memoriesForUnit(
  unit: SourceUnit,
  source: ScannedSource,
  created: string,
): Memory[] {
  const chunks = chunkByWords(unit.text);
  return chunks.map((chunk, index) => {
    const partSuffix =
      chunks.length > 1 ? ` (part ${index + 1} of ${chunks.length})` : '';
    return {
      id: ulid(),
      class: KIND_TO_CLASS[source.kind],
      scope: 'team' as const,
      status: 'active' as const,
      // Humans upgrade to `required` in the init PR review; the importer
      // never floats candidates into the force-included context set.
      priority: 'advisory' as const,
      title: truncateTitle(unit.title, partSuffix.length) + partSuffix,
      created,
      supersedes: [],
      tags: ['imported', `source:${source.path}`],
      ttl_days: null,
      body: chunk.trim(),
    };
  });
}

export function importSources(
  sources: ScannedSource[],
  options: ImportOptions = {},
): ImportResult {
  const now = options.now ?? (() => new Date());
  const created = now().toISOString().slice(0, 10);
  const candidates: Memory[] = [];
  for (const source of sources) {
    for (const unit of unitsForSource(source)) {
      candidates.push(...memoriesForUnit(unit, source, created));
    }
  }
  return { sources, candidates };
}

/** Scans `repoDir` and converts everything found. Never writes. */
export function importRepo(
  repoDir: string,
  options: ImportOptions = {},
): ImportResult {
  return importSources(scanRepo(repoDir), options);
}
