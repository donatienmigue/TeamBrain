import { describe, expect, it } from 'vitest';
import { supportedTools } from '@teambrain/hooks';
import { loadAdapters } from './adapters-data.js';

// E6.3: adapters.yaml is reviewable data, and it must not drift from the code
// registry that tb install / tb doctor / the README matrix resolve from.

describe('adapters.yaml', () => {
  it('validates against the schema', () => {
    expect(() => loadAdapters()).not.toThrow();
  });

  it('its tool set matches the code registry (cannot drift)', () => {
    const yamlTools = loadAdapters()
      .adapters.map((a) => a.tool)
      .sort();
    expect(yamlTools).toEqual(supportedTools());
  });

  it('every entry declares a known capture tier', () => {
    for (const a of loadAdapters().adapters) {
      expect(['T1', 'T2', 'T3']).toContain(a.tier);
    }
  });
});
