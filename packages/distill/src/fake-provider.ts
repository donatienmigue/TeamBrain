import type { Provider, ProviderRequest } from './provider.js';

// FakeProvider — the test/offline driver (CONTRACTS C5: "drivers: …, fake
// (fixtures)"). Tests never touch the network, so every distill test and the
// golden pipeline run through this. A responder inspects the request
// (system + prompt) and returns the structured value; complete() then
// zod-validates it exactly as a real driver would, so a fixture that returns a
// malformed value exercises the "invalid → discard" path for free.

export interface FakeRequestView {
  system: string;
  prompt: string;
}

/** Decides the raw (pre-validation) response for a request. */
export type FakeResponder = (request: FakeRequestView) => unknown;

/**
 * A Provider backed by a responder function. The responder returns the raw
 * value; `complete` validates it against the request schema (throwing on
 * mismatch, which the draft stage records as a discard).
 */
export function fakeProvider(responder: FakeResponder): Provider {
  return {
    id: 'fake',
    complete<T>(request: ProviderRequest<T>): Promise<T> {
      // parse (not safeParse): an invalid fixture must reject, mirroring a real
      // driver that failed to produce schema-valid output. try/catch turns the
      // synchronous throw into a rejected promise, matching the async drivers.
      try {
        const raw = responder({
          system: request.system,
          prompt: request.prompt,
        });
        return Promise.resolve(request.schema.parse(raw));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

/** A fixture: when `match` is a substring of `system\nprompt`, return `value`. */
export interface FakeFixture {
  match: string;
  value: unknown;
}

/**
 * Convenience responder built from substring-matched fixtures, with a fallback
 * used when nothing matches (e.g. the "consistent" verdict for contradiction
 * checks between unrelated memories). First matching fixture wins.
 */
export function fixtureResponder(
  fixtures: FakeFixture[],
  fallback?: unknown,
): FakeResponder {
  return ({ system, prompt }) => {
    const haystack = `${system}\n${prompt}`;
    for (const fixture of fixtures) {
      if (haystack.includes(fixture.match)) return fixture.value;
    }
    if (fallback !== undefined) return fallback;
    throw new Error(
      `fakeProvider: no fixture matched request (first 80 chars: ` +
        `${prompt.slice(0, 80)!.replace(/\n/g, ' ')})`,
    );
  };
}
