import { describe, expect, it } from 'vitest';
import {
  EnvironmentError,
  TeamBrainError,
  UserError,
  ValidationError,
  exitCodeForError,
} from './errors.js';
import { FrontmatterParseError, parseMemoryFile } from './frontmatter.js';
import { BrainConfigParseError, parseBrainConfig } from './brain-config.js';
import { SessionEventParseError, parseSessionEventLine } from './events.js';

describe('error hierarchy', () => {
  it('maps each class to its C6 exit code', () => {
    expect(new UserError('bad flag').exitCode).toBe(1);
    expect(new EnvironmentError('no daemon').exitCode).toBe(2);
    expect(new ValidationError('bad schema').exitCode).toBe(3);
  });

  it('all classes are TeamBrainError and Error instances', () => {
    for (const err of [
      new UserError('u'),
      new EnvironmentError('e'),
      new ValidationError('v'),
    ]) {
      expect(err).toBeInstanceOf(TeamBrainError);
      expect(err).toBeInstanceOf(Error);
    }
    expect(new UserError('u').name).toBe('UserError');
  });

  it('parse errors are ValidationErrors carrying exit code 3', () => {
    const parseFailures: Array<() => void> = [
      () => parseMemoryFile('no fences'),
      () => parseBrainConfig('version: 99'),
      () => parseSessionEventLine('not json'),
    ];
    const expectedClasses = [
      FrontmatterParseError,
      BrainConfigParseError,
      SessionEventParseError,
    ];
    parseFailures.forEach((parseFailure, i) => {
      let caught: unknown;
      try {
        parseFailure();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(expectedClasses[i]);
      expect(caught).toBeInstanceOf(ValidationError);
      expect(exitCodeForError(caught)).toBe(3);
    });
  });
});

describe('exitCodeForError', () => {
  it('returns the typed exit code for TeamBrainErrors', () => {
    expect(exitCodeForError(new UserError('u'))).toBe(1);
    expect(exitCodeForError(new EnvironmentError('e'))).toBe(2);
    expect(exitCodeForError(new ValidationError('v'))).toBe(3);
  });

  it('treats unknown throwables as environment errors', () => {
    expect(exitCodeForError(new Error('boom'))).toBe(2);
    expect(exitCodeForError('a string')).toBe(2);
    expect(exitCodeForError(undefined)).toBe(2);
  });
});
