import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, LOG_RETENTION_DAYS } from './log.js';

const tempDirs: string[] = [];

function makeLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teambrain-log-test-'));
  tempDirs.push(dir);
  return dir;
}

function readRecords(
  dir: string,
  stamp: string,
): Array<Record<string, unknown>> {
  const text = readFileSync(join(dir, `${stamp}.log`), 'utf8');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function firstRecord(dir: string, stamp: string): Record<string, unknown> {
  const records = readRecords(dir, stamp);
  expect(records.length).toBeGreaterThan(0);
  return records[0] as Record<string, unknown>;
}

const FIXED_NOW = new Date('2026-07-03T10:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createLogger', () => {
  it('writes structured JSONL records to the daily file', () => {
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.info('daemon started', { pid: 123 });
    logger.warn('slow reindex', { ms: 4200 });

    const records = readRecords(dir, '2026-07-03');
    expect(records).toEqual([
      {
        t: FIXED_NOW.toISOString(),
        level: 'info',
        msg: 'daemon started',
        pid: 123,
      },
      {
        t: FIXED_NOW.toISOString(),
        level: 'warn',
        msg: 'slow reindex',
        ms: 4200,
      },
    ]);
  });

  it('drops records below the minimum level', () => {
    const dir = makeLogDir();
    const logger = createLogger({
      dir,
      now: () => FIXED_NOW,
      minLevel: 'warn',
    });
    logger.debug('noise');
    logger.info('still noise');
    logger.error('kept');
    expect(readRecords(dir, '2026-07-03').map((r) => r['level'])).toEqual([
      'error',
    ]);
  });

  it('honors TEAMBRAIN_LOG_LEVEL when no explicit level is set', () => {
    vi.stubEnv('TEAMBRAIN_LOG_LEVEL', 'error');
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.warn('dropped');
    logger.error('kept');
    expect(readRecords(dir, '2026-07-03')).toHaveLength(1);
  });

  it('falls back to info for invalid TEAMBRAIN_LOG_LEVEL values', () => {
    vi.stubEnv('TEAMBRAIN_LOG_LEVEL', 'verbose');
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.debug('dropped');
    logger.info('kept');
    expect(readRecords(dir, '2026-07-03')).toHaveLength(1);
  });

  it('redacts body|content|prompt fields at info and above, at any depth', () => {
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.info('memory proposed', {
      body: 'never log me',
      nested: { prompt: 'secret prompt', ok: 1 },
      list: [{ content: 'secret content' }],
      safe: 'kept',
    });

    const record = firstRecord(dir, '2026-07-03');
    expect(record).toMatchObject({
      body: '«REDACTED:field»',
      nested: { prompt: '«REDACTED:field»', ok: 1 },
      list: [{ content: '«REDACTED:field»' }],
      safe: 'kept',
    });
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(JSON.stringify(record)).not.toContain('never log me');
  });

  it('passes those fields through at debug level only', () => {
    const dir = makeLogDir();
    const logger = createLogger({
      dir,
      now: () => FIXED_NOW,
      minLevel: 'debug',
    });
    logger.debug('raw capture', { body: 'visible at debug' });
    const record = firstRecord(dir, '2026-07-03');
    expect(record['body']).toBe('visible at debug');
  });

  it('binds child fields into every record', () => {
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW }).child({
      component: 'daemon',
    });
    logger.info('tick');
    const record = firstRecord(dir, '2026-07-03');
    expect(record['component']).toBe('daemon');
  });

  it('flattens Error values in fields', () => {
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.error('reindex failed', { cause: new RangeError('boom') });
    const record = firstRecord(dir, '2026-07-03');
    expect(record['cause']).toBe('RangeError: boom');
  });

  it('deletes log files older than the 7-day retention window', () => {
    const dir = makeLogDir();
    // 2026-06-27 is the oldest kept day (retention 7 => today-6).
    writeFileSync(join(dir, '2026-06-26.log'), 'old\n');
    writeFileSync(join(dir, '2026-06-27.log'), 'boundary\n');
    writeFileSync(join(dir, 'unrelated.txt'), 'not a log\n');

    const logger = createLogger({ dir, now: () => FIXED_NOW });
    logger.info('trigger cleanup');

    const names = readdirSync(dir).sort();
    expect(names).toEqual([
      '2026-06-27.log',
      '2026-07-03.log',
      'unrelated.txt',
    ]);
    expect(LOG_RETENTION_DAYS).toBe(7);
  });

  it('starts a new file when the day rolls over', () => {
    const dir = makeLogDir();
    let clock = new Date('2026-07-03T23:59:00.000Z');
    const logger = createLogger({ dir, now: () => clock });
    logger.info('before midnight');
    clock = new Date('2026-07-04T00:01:00.000Z');
    logger.info('after midnight');

    expect(existsSync(join(dir, '2026-07-03.log'))).toBe(true);
    expect(existsSync(join(dir, '2026-07-04.log'))).toBe(true);
  });

  it('never throws when the log directory is unusable', () => {
    const dir = makeLogDir();
    const blockingFile = join(dir, 'not-a-dir');
    writeFileSync(blockingFile, 'occupied');
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const logger = createLogger({ dir: blockingFile, now: () => FIXED_NOW });
    expect(() => {
      logger.info('first');
      logger.info('second');
    }).not.toThrow();
    // One degradation notice, not one per record.
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('logger degraded');
  });

  it('breaks reference cycles instead of dropping the record', () => {
    const dir = makeLogDir();
    const logger = createLogger({ dir, now: () => FIXED_NOW });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const shared = { reused: true };
    logger.info('with circular fields', {
      circular,
      pair: [shared, shared],
    });
    const record = firstRecord(dir, '2026-07-03');
    expect(record['msg']).toBe('with circular fields');
    expect(record['circular']).toEqual({ self: '«circular»' });
    // Shared (non-circular) references still serialize fully.
    expect(record['pair']).toEqual([{ reused: true }, { reused: true }]);
  });
});
