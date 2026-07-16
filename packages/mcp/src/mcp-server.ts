import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CORE_VERSION, memoryClassSchema } from '@teambrain/core';
import { renderMemoryBlock, type MemoryView } from './render.js';
import {
  renderContextBundle,
  SESSION_CONTEXT_MAX_CHARS,
} from './context.js';
import {
  createTools,
  memoryFeedbackInput,
  memoryProposeInput,
  memorySearchInput,
  type ToolContext,
} from './tools.js';

// M4.2 stdio MCP server (C3). Server name `teambrain` → the 4 tools appear
// to agents as mcp__teambrain__*. Each tool returns two channels: `content`
// carries the C3-rendered, injection-safe text an agent reads; the
// `structuredContent` (gated by outputSchema) carries the machine-readable
// C3 result for programmatic clients.

export const MCP_SERVER_NAME = 'teambrain';

const memoryViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  class: memoryClassSchema.optional(),
  provenance: z.string(),
});

function textResult<S extends Record<string, unknown>>(
  text: string,
  structuredContent: S,
): { content: [{ type: 'text'; text: string }]; structuredContent: S } {
  return { content: [{ type: 'text', text }], structuredContent };
}

function renderMemoryList(views: MemoryView[], emptyText: string): string {
  return views.length === 0
    ? emptyText
    : views.map(renderMemoryBlock).join('\n\n');
}

/** Builds the MCP server over an already-open backend (no transport attached). */
export function createMcpServer(context: ToolContext): McpServer {
  const tools = createTools(context);
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: CORE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'memory_context',
    {
      description:
        'Return the standing team-memory context: all required rules plus ' +
        'the most relevant recent memories, within a 2000-token budget.',
      outputSchema: {
        required: z.array(memoryViewSchema),
        relevant: z.array(memoryViewSchema),
        token_estimate: z.number(),
      },
    },
    () => {
      const context_ = tools.memoryContext();
      // The text channel carries the same bundle a SessionStart hook gets,
      // including the CodeMap index block when the codemap is non-empty.
      const bundle = renderContextBundle(
        context_,
        SESSION_CONTEXT_MAX_CHARS,
        context.backend.codemapStats?.() ?? null,
      );
      return textResult(bundle, context_);
    },
  );

  server.registerTool(
    'memory_search',
    {
      description:
        'Search team memory for decisions, conventions, map, and learnings ' +
        'relevant to a query. Returns ranked memories.',
      inputSchema: memorySearchInput,
      outputSchema: { memories: z.array(memoryViewSchema) },
    },
    async (args) => {
      const memories = await tools.memorySearch(args);
      return textResult(renderMemoryList(memories, 'No matching memories.'), {
        memories,
      });
    },
  );

  server.registerTool(
    'memory_propose',
    {
      description:
        'Queue a candidate memory for human review. It is spooled locally ' +
        'only — nothing is written to the brain until a human approves a PR.',
      inputSchema: memoryProposeInput,
      outputSchema: { queued: z.literal(true), candidate_id: z.string() },
    },
    (args) => {
      const result = tools.memoryPropose(args);
      return textResult(
        `Queued candidate ${result.candidate_id} for human review.`,
        result,
      );
    },
  );

  server.registerTool(
    'memory_feedback',
    {
      description:
        'Record whether a retrieved memory (by id) was useful, to tune ' +
        'future retrieval.',
      inputSchema: memoryFeedbackInput,
      outputSchema: { ok: z.literal(true) },
    },
    (args) => {
      const result = tools.memoryFeedback(args);
      return textResult(`Recorded feedback for ${args.id}.`, result);
    },
  );

  return server;
}

/** Builds the server and attaches a stdio transport (the `tb mcp` entry). */
export async function runMcpServer(context: ToolContext): Promise<McpServer> {
  const server = createMcpServer(context);
  await server.connect(new StdioServerTransport());
  return server;
}
