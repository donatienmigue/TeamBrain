import { scanForInjection } from '@teambrain/core';
import { renderMemoryBlock } from '@teambrain/mcp';
import type { SystemUnderTest } from './scorer.js';

// The two in-process systems used to validate the benchmark and to score
// TeamBrain reproducibly from a clean clone. A live MCP-client adapter (for
// scoring Mori/Mem0/etc. over the wire) implements the same SystemUnderTest
// interface — that is the whole point of the abstraction.

/**
 * TeamBrain, in-process. Tier 1 is the `tb lint` injection gate
 * (scanForInjection); tier 2 is the C3 rendering rule (renderMemoryBlock, whose
 * CommonMark dynamic fence is the F1 fix). No network, so it reproduces
 * anywhere.
 */
export const teambrainSystem: SystemUnderTest = {
  name: 'teambrain',
  ingestBlocked: (body) => scanForInjection(body).length > 0,
  serve: (body) =>
    renderMemoryBlock({
      id: '01BENCHMARKCANDIDATE00000',
      title: 'candidate',
      body,
      provenance: 'inject-bench',
      source: 'memory',
    }),
};

/**
 * The validity control (E5.3): a knowingly-vulnerable server that stores any
 * payload and serves it raw. It MUST score 0 — if it doesn't, the benchmark
 * measures nothing and publishing it would be worse than silence.
 */
export const vulnerableMockSystem: SystemUnderTest = {
  name: 'vulnerable-mock',
  ingestBlocked: () => false,
  serve: (body) => body,
};
