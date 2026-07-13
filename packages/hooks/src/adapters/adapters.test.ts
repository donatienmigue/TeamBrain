import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildDenyMatcher } from '@teambrain/redact';
import type { HookContext } from '../map.js';
import { processHookPayload, type CaptureHookName } from '../run.js';
import { ADAPTERS, supportedTools } from '../registry.js';
import { claudeCodeAdapter } from './claude-code.js';
import { cursorAdapter } from './cursor.js';
import { codexAdapter } from './codex.js';

// A0.2/A0.3: the registry is coherent, and the claude-code adapter is a pure
// re-routing of the original mappers — same fixture in, same events out as
// the pre-framework processHookPayload path (zero behavior change).

const here = dirname(fileURLToPath(import.meta.url));

function testContext(tool: string): HookContext {
  return {
    sid: 'ctx-sid',
    repo: 'acme/api',
    branch: 'feat/webhooks',
    tool,
    model: 'claude-opus-4-8',
    redactionLevel: 'strict',
    now: () => new Date('2026-07-05T12:00:00.000Z'),
    deny: buildDenyMatcher(['*.env']),
    session: {
      startedAt: new Date('2026-07-05T11:30:00.000Z'),
      turns: 3,
      commitShas: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
    },
  };
}

describe('adapter registry (A0.3)', () => {
  it('every entry is keyed by its adapter tool id and fully declared', () => {
    for (const [key, adapter] of Object.entries(ADAPTERS)) {
      expect(adapter.tool).toBe(key);
      expect(adapter.displayName.length).toBeGreaterThan(0);
      expect(['native-hooks', 'mcp-inference', 'serving-only']).toContain(
        adapter.tier,
      );
      expect(adapter.describeDegradation().length).toBeGreaterThan(0);
    }
    expect(supportedTools()).toEqual(Object.keys(ADAPTERS).sort());
  });

  it('mcp-inference adapters declare no tool_use capture (honesty)', () => {
    for (const adapter of Object.values(ADAPTERS)) {
      if (adapter.tier === 'mcp-inference') {
        expect(adapter.capabilities.toolUse).toBe(false);
        expect(adapter.capabilities.commitShas).toBe(false);
      }
    }
  });
});

describe('claude-code adapter (A0.2 zero behavior change)', () => {
  const fixture = readFileSync(
    join(
      here,
      '..',
      '..',
      '..',
      '..',
      'testdata',
      'sessions',
      'raw-claude.jsonl',
    ),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);

  it('mapEvent routes each fixture payload exactly like processHookPayload', () => {
    for (const line of fixture) {
      const raw = JSON.parse(line) as { hook_event_name: CaptureHookName };
      const viaAdapter = claudeCodeAdapter.mapEvent(
        raw,
        testContext('claude-code'),
      );
      // processHookPayload redacts; compare against its pre-emit event by
      // redacting nothing-sensitive fields is fragile — instead assert the
      // *mapping* agrees: same nullness, same ev, same data shape.
      const viaPipeline = processHookPayload(
        raw.hook_event_name,
        line,
        testContext('claude-code'),
      ).event;
      if (viaPipeline === null) {
        expect(viaAdapter).toBeNull();
      } else {
        expect(viaAdapter).not.toBeNull();
        expect(viaAdapter?.ev).toBe(viaPipeline.ev);
        expect(Object.keys(viaAdapter?.data ?? {}).sort()).toEqual(
          Object.keys(viaPipeline.data).sort(),
        );
      }
    }
  });

  it('returns null for unknown hook payloads', () => {
    expect(
      claudeCodeAdapter.mapEvent(
        { hook_event_name: 'Bogus' },
        testContext('claude-code'),
      ),
    ).toBeNull();
    expect(
      claudeCodeAdapter.mapEvent('not-an-object', testContext('claude-code')),
    ).toBeNull();
  });

  it('plans the two claude-code files under the project dir', () => {
    const plan = claudeCodeAdapter.installPlan(join(sep, 'proj'));
    expect(plan.map((f) => f.path)).toEqual([
      join(sep, 'proj', '.mcp.json'),
      join(sep, 'proj', '.claude', 'settings.json'),
    ]);
    // Pure + idempotent: applying a merge to its own output reports no change.
    for (const file of plan) {
      if (file.format !== 'json') continue;
      const once = file.merge({});
      expect(once.changed).toBe(true);
      expect(file.merge(once.value).changed).toBe(false);
    }
  });
});

describe('tier-B adapters never map hook payloads', () => {
  it('cursor + codex mapEvent are structurally inert', () => {
    const payload = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'a.ts', content: 'SECRET' },
    };
    expect(cursorAdapter.mapEvent(payload, testContext('cursor'))).toBeNull();
    expect(codexAdapter.mapEvent(payload, testContext('codex'))).toBeNull();
  });
});
