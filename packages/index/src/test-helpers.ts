import type { LogFields, Logger, LogLevel } from '@teambrain/core';
import type { IndexableDoc } from './types.js';

// Shared test utilities (not exported from the package).

export interface CapturedLog {
  level: LogLevel;
  msg: string;
  fields: LogFields;
}

export interface CaptureLogger extends Logger {
  entries: CapturedLog[];
}

export function captureLogger(): CaptureLogger {
  const entries: CapturedLog[] = [];
  const record =
    (level: LogLevel) =>
    (msg: string, fields: LogFields = {}): void => {
      entries.push({ level, msg, fields });
    };
  const logger: CaptureLogger = {
    entries,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  };
  return logger;
}

let docCounter = 0;

/** Minimal valid IndexableDoc with overridable fields. */
export function makeDoc(overrides: Partial<IndexableDoc> = {}): IndexableDoc {
  docCounter += 1;
  return {
    id: `doc-${docCounter}`,
    title: `Test document ${docCounter}`,
    body: 'A perfectly ordinary body about nothing in particular.',
    class: 'convention',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    created: '2026-01-01',
    ttl_days: null,
    tags: [],
    ...overrides,
  };
}
