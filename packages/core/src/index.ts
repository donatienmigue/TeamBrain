import { createRequire } from 'node:module';

/**
 * The version `tb --version` and the MCP server report. Resolution order:
 * 1. package.json next to this module — npm installs, dev, tests; can never
 *    drift from what npm publishes (v0.2.0 shipped a stale hardcoded
 *    version and the release smoke gate caught it).
 * 2. TEAMBRAIN_VERSION, baked in via `bun build --define` for the standalone
 *    binaries, where package.json isn't bundled (verified: `bun --compile`
 *    aborts on the require without this fallback — v0.2.2 binaries job).
 * 3. A loud sentinel — never a crash. All @teambrain/* version in lockstep.
 */
function resolveVersion(): string {
  try {
    return (
      createRequire(import.meta.url)('../package.json') as { version: string }
    ).version;
  } catch {
    // Dotted access on purpose: `bun build --define` rewrites the exact
    // expression `process.env.TEAMBRAIN_VERSION`; bracket access is invisible
    // to it (verified locally).
    return process.env.TEAMBRAIN_VERSION ?? '0.0.0-unknown';
  }
}
export const CORE_VERSION: string = resolveVersion();

export { ulid, isUlid, ULID_REGEX } from './ulid.js';
export { slugify } from './slug.js';
export {
  MEMORY_CLASSES,
  MEMORY_CLASS_DIRECTORIES,
  memoryClassSchema,
  ulidSchema,
  isoDateSchema,
  evidenceSchema,
  memoryFrontmatterSchema,
  memoryPath,
} from './memory.js';
export type {
  MemoryClass,
  Evidence,
  MemoryFrontmatter,
  Memory,
} from './memory.js';
export {
  sessionEventSchema,
  candidateDraftSchema,
  parseSessionEventLine,
  serializeSessionEvent,
  SessionEventParseError,
} from './events.js';
export type { SessionEvent, CandidateDraft } from './events.js';
export {
  brainConfigSchema,
  parseBrainConfig,
  BrainConfigParseError,
} from './brain-config.js';
export type { BrainConfig } from './brain-config.js';
export {
  parseMemoryFile,
  serializeMemoryFile,
  FrontmatterParseError,
} from './frontmatter.js';
export type { ParsedMemoryFile } from './frontmatter.js';
export { INJECTION_PATTERNS, scanForInjection } from './injection-patterns.js';
export type {
  InjectionPattern,
  InjectionFinding,
} from './injection-patterns.js';
export { MAX_BODY_WORDS, lintMemoryText, lintBrain } from './lint.js';
export type {
  LintRule,
  LintViolation,
  LintOptions,
  BrainLintReport,
} from './lint.js';
export {
  TeamBrainError,
  UserError,
  EnvironmentError,
  ValidationError,
  exitCodeForError,
} from './errors.js';
export type { ErrorExitCode } from './errors.js';
export { formatZodIssues } from './zod-issues.js';
export {
  LOG_LEVELS,
  LOG_RETENTION_DAYS,
  createLogger,
  defaultLogDir,
} from './log.js';
export type { LogLevel, LogFields, Logger, LoggerOptions } from './log.js';
export {
  codemapEntrySchema,
  parseCodemapEntry,
  serializeCodemapEntry,
  CodemapEntryParseError,
} from './codemap-entry.js';
export type {
  CodemapEntryFrontmatter,
  ParsedCodemapEntry,
} from './codemap-entry.js';
export { fnv1a, codemapArm, effectiveHoldout } from './codemap-arm.js';
export type { CodemapArm } from './codemap-arm.js';
