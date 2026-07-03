import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// M1.3 shared structured logger. JSONL records in ~/.teambrain/logs/
// (C7 machine-local layout), one file per UTC day, 7-day retention.
// Guardrails: fields named body|content|prompt are redacted at info and
// above (principle 3), and the logger itself never throws (principle 2).

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_RETENTION_DAYS = 7;

// Field names whose values never reach the log at info+ (principle 3).
const REDACTED_FIELD_NAMES = new Set(['body', 'content', 'prompt']);
const REDACTION_PLACEHOLDER = '«REDACTED:field»';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger with `fields` bound into every record. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  /** Log directory; defaults to ~/.teambrain/logs (C7). */
  dir?: string;
  /** Threshold; defaults to $TEAMBRAIN_LOG_LEVEL, then 'info'. */
  minLevel?: LogLevel;
  /** Injectable clock for rotation tests. */
  now?: () => Date;
}

export function defaultLogDir(): string {
  return join(homedir(), '.teambrain', 'logs');
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value ?? '');
}

/**
 * Prepares field values for JSON: redacts body|content|prompt keys when
 * `redact` is set, flattens Errors, and breaks reference cycles (path-
 * based, so shared non-circular references still serialize fully).
 */
function sanitizeValue(
  value: unknown,
  redact: boolean,
  pathObjects: WeakSet<object>,
): unknown {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  if (pathObjects.has(value)) return '«circular»';
  pathObjects.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => sanitizeValue(entry, redact, pathObjects));
  } else {
    const plain: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      plain[key] =
        redact && REDACTED_FIELD_NAMES.has(key.toLowerCase())
          ? REDACTION_PLACEHOLDER
          : sanitizeValue(entry, redact, pathObjects);
    }
    result = plain;
  }
  pathObjects.delete(value);
  return result;
}

function utcDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

class FileLogger implements Logger {
  private readonly dir: string;
  private readonly minLevel: LogLevel;
  private readonly now: () => Date;
  private readonly boundFields: LogFields;
  private lastCleanupStamp: string | undefined;
  private degradedNoticeSent = false;

  constructor(options: LoggerOptions, boundFields: LogFields) {
    this.dir = options.dir ?? defaultLogDir();
    const envLevel = process.env['TEAMBRAIN_LOG_LEVEL'];
    this.minLevel =
      options.minLevel ?? (isLogLevel(envLevel) ? envLevel : 'info');
    this.now = options.now ?? (() => new Date());
    this.boundFields = boundFields;
  }

  debug(msg: string, fields?: LogFields): void {
    this.write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.write('error', msg, fields);
  }

  child(fields: LogFields): Logger {
    return new FileLogger(
      { dir: this.dir, now: this.now, minLevel: this.minLevel },
      { ...this.boundFields, ...fields },
    );
  }

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;
    try {
      const timestamp = this.now();
      // The redaction guardrail: raw body|content|prompt values may only
      // ever appear at debug level (principle 3).
      const mergedFields = sanitizeValue(
        { ...this.boundFields, ...fields },
        level !== 'debug',
        new WeakSet(),
      );

      let line: string;
      try {
        line = JSON.stringify({
          t: timestamp.toISOString(),
          level,
          msg,
          ...(mergedFields as Record<string, unknown>),
        });
      } catch {
        // Unserializable fields (e.g. circular): keep the message.
        line = JSON.stringify({
          t: timestamp.toISOString(),
          level,
          msg,
          logger_note: 'fields dropped: not serializable',
        });
      }

      mkdirSync(this.dir, { recursive: true });
      const stamp = utcDateStamp(timestamp);
      appendFileSync(join(this.dir, `${stamp}.log`), line + '\n', 'utf8');
      if (this.lastCleanupStamp !== stamp) {
        this.lastCleanupStamp = stamp;
        this.deleteExpiredLogs(timestamp);
      }
    } catch (err) {
      // The logger must never break its caller. One stderr notice per
      // instance documents the degradation (no silent catch).
      if (!this.degradedNoticeSent) {
        this.degradedNoticeSent = true;
        process.stderr.write(
          `teambrain logger degraded (${(err as Error).message}); further records dropped\n`,
        );
      }
    }
  }

  private deleteExpiredLogs(reference: Date): void {
    const oldestKeptMs =
      reference.getTime() - (LOG_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000;
    const oldestKeptStamp = utcDateStamp(new Date(oldestKeptMs));
    for (const name of readdirSync(this.dir)) {
      const match = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      // Lexicographic order matches date order for YYYY-MM-DD stamps.
      if (match?.[1] !== undefined && match[1] < oldestKeptStamp) {
        unlinkSync(join(this.dir, name));
      }
    }
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new FileLogger(options, {});
}
