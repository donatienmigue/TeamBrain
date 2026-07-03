export const CORE_VERSION = '0.0.1';

export { ulid, isUlid, ULID_REGEX } from './ulid.js';
export { slugify } from './slug.js';
export {
  MEMORY_CLASSES,
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
