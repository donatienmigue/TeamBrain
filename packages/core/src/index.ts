import { createRequire } from 'node:module';

// The version `tb --version` and the MCP server report. Read from
// package.json at runtime so it can never drift from what npm publishes —
// v0.2.0 shipped printing a stale hardcoded '0.0.1' and the release smoke
// gate caught it. All @teambrain/* packages version in lockstep.
export const CORE_VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

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
