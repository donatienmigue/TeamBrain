import { describe, expect, it } from 'vitest';
import { BrainConfigParseError, parseBrainConfig } from './brain-config.js';

describe('parseBrainConfig', () => {
  it('parses a full config', () => {
    const config = parseBrainConfig(
      [
        'version: 1',
        'capture:',
        '  level: full',
        'redaction:',
        '  level: standard',
        'distill:',
        '  model: claude-opus-4-8',
        'required_tags:',
        '  - security',
      ].join('\n'),
    );
    expect(config.capture.level).toBe('full');
    expect(config.redaction.level).toBe('standard');
    expect(config.distill?.model).toBe('claude-opus-4-8');
    expect(config.required_tags).toEqual(['security']);
  });

  it('applies privacy-first defaults to a minimal config', () => {
    const config = parseBrainConfig('version: 1');
    expect(config.capture.level).toBe('metadata');
    expect(config.redaction.level).toBe('strict');
    expect(config.distill).toBeUndefined();
    expect(config.required_tags).toEqual([]);
  });

  it('passes unknown keys through (additive-friendly, e.g. distiller state)', () => {
    const config = parseBrainConfig('version: 1\nstate:\n  watermark: abc123');
    expect((config as Record<string, unknown>)['state']).toEqual({
      watermark: 'abc123',
    });
  });

  it('rejects unsupported versions, bad enum values, and invalid YAML', () => {
    expect(() => parseBrainConfig('version: 2')).toThrow(BrainConfigParseError);
    expect(() =>
      parseBrainConfig('version: 1\ncapture:\n  level: everything'),
    ).toThrow(/capture.level/);
    expect(() => parseBrainConfig('version: 1\ndistill:\n  model: ""')).toThrow(
      BrainConfigParseError,
    );
    expect(() => parseBrainConfig('[unclosed')).toThrow(/invalid YAML/);
  });
});
