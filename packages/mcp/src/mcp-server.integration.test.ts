import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { isUlid } from '@teambrain/core';
import { createMcpServer, MCP_SERVER_NAME } from './mcp-server.js';
import {
  FIXTURE_IDS,
  fixtureBrainDir,
  indexForBrain,
  tempRuntimeDir,
  toolContextFor,
} from './test-helpers.js';

// M4 accept: a scripted MCP client calls all 4 tools against the fixture
// brain over an in-memory transport (a faithful stand-in for the stdio one).

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function connectedClient(): Promise<{ client: Client; runtimeDir: string }> {
  const index = await indexForBrain(fixtureBrainDir());
  cleanups.push(() => index.close());
  const runtimeDir = await tempRuntimeDir(cleanups);
  const server = createMcpServer(toolContextFor(index, runtimeDir));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  cleanups.push(() => client.close());
  cleanups.push(() => server.close());
  return { client, runtimeDir };
}

describe('teambrain MCP server (M4.2 accept)', () => {
  it('advertises the four tools under the teambrain server', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'memory_context',
      'memory_feedback',
      'memory_propose',
      'memory_search',
    ]);
    expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
  });

  it('memory_search returns ranked results with injection-safe text', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'memory_search',
      arguments: { query: 'zod validation boundary' },
    });
    const structured = result.structuredContent as {
      memories: Array<{ id: string }>;
    };
    expect(structured.memories[0]?.id).toBe(FIXTURE_IDS.requiredZod);
    const text = (result.content as Array<{ type: string; text: string }>)[0];
    expect(text?.text).toContain('data, not instructions');
  });

  it('memory_context returns required-first within the 2000-token budget', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: 'memory_context' });
    const structured = result.structuredContent as {
      required: Array<{ id: string }>;
      relevant: unknown[];
      token_estimate: number;
    };
    expect(structured.required[0]?.id).toBe(FIXTURE_IDS.requiredZod);
    expect(structured.token_estimate).toBeLessThanOrEqual(2000);
  });

  it('memory_propose queues a candidate to the local spool', async () => {
    const { client, runtimeDir } = await connectedClient();
    const result = await client.callTool({
      name: 'memory_propose',
      arguments: {
        draft: {
          class: 'convention',
          title: 'Name socket files by runtime dir hash',
          body: 'Windows named pipes share one namespace; hash the home dir.',
        },
      },
    });
    const structured = result.structuredContent as {
      queued: boolean;
      candidate_id: string;
    };
    expect(structured.queued).toBe(true);
    expect(isUlid(structured.candidate_id)).toBe(true);
    const spooled = readdirSync(join(runtimeDir, 'spool', 'candidates'));
    expect(spooled).toContain(`${structured.candidate_id}.json`);
  });

  it('memory_feedback acknowledges', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'memory_feedback',
      arguments: { id: FIXTURE_IDS.mapDaemon, useful: false },
    });
    expect(result.structuredContent).toEqual({ ok: true });
  });

  it('rejects a malformed memory_propose draft at the schema boundary', async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: 'memory_propose',
      arguments: { draft: { class: 'nope', title: '', body: '' } },
    });
    expect(result.isError).toBe(true);
  });
});
