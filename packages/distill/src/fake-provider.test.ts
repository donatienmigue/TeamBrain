import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { fakeProvider, fixtureResponder } from './fake-provider.js';

const schema = z.object({ verdict: z.enum(['a', 'b']) });

describe('fakeProvider', () => {
  it('validates the responder value against the request schema', async () => {
    const provider = fakeProvider(() => ({ verdict: 'a' }));
    await expect(
      provider.complete({ system: 's', prompt: 'p', schema }),
    ).resolves.toEqual({ verdict: 'a' });
  });

  it('rejects when the responder returns a schema-invalid value', async () => {
    const provider = fakeProvider(() => ({ verdict: 'nope' }));
    await expect(
      provider.complete({ system: 's', prompt: 'p', schema }),
    ).rejects.toThrow();
  });

  it('exposes system and prompt to the responder', async () => {
    const seen: string[] = [];
    const provider = fakeProvider((req) => {
      seen.push(`${req.system}|${req.prompt}`);
      return { verdict: 'b' };
    });
    await provider.complete({ system: 'SYS', prompt: 'PROMPT', schema });
    expect(seen).toEqual(['SYS|PROMPT']);
  });
});

describe('fixtureResponder', () => {
  it('returns the first matching fixture, else the fallback', () => {
    const responder = fixtureResponder(
      [{ match: 'hello', value: { verdict: 'a' } }],
      { verdict: 'b' },
    );
    expect(responder({ system: '', prompt: 'say hello there' })).toEqual({
      verdict: 'a',
    });
    expect(responder({ system: '', prompt: 'nothing' })).toEqual({
      verdict: 'b',
    });
  });

  it('throws when nothing matches and there is no fallback', () => {
    const responder = fixtureResponder([{ match: 'x', value: 1 }]);
    expect(() => responder({ system: '', prompt: 'y' })).toThrow();
  });
});
