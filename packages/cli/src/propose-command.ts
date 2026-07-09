import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ValidationError,
  candidateDraftSchema,
  exitCodeForError,
  formatZodIssues,
  type CandidateDraft,
  type ErrorExitCode,
} from '@teambrain/core';
import {
  candidateSpoolDir,
  resolveRuntimeDir,
  sessionSpoolDir,
  writeCandidate,
} from '@teambrain/mcp';

// C6 `tb propose` (TECH_BRIEF §4.2): manually draft a memory from the last
// session — the escape hatch when a human wants to queue knowledge without
// waiting for an agent to call memory_propose. Identical trust model to the
// MCP tool (C3): the draft lands in the LOCAL candidate spool only; the
// distiller surfaces it in the next memory PR. Nothing here writes to the
// brain (principle 4).

export interface ProposeInput {
  class?: string;
  title?: string;
  /** Body text; when absent the command reads it from stdin (piped input). */
  body?: string;
  /** Comma-separated or repeated tags, already split by the caller. */
  tags?: string[];
}

export interface ProposeOptions {
  runtimeDir?: string;
  /** Injectable stdin reader (tests); default reads fd 0 when not a TTY. */
  readStdin?: () => string;
  now?: () => Date;
}

/** Sid of the most recently modified session record, or null (spool empty). */
function latestSessionSid(runtimeDir: string): string | null {
  const dir = sessionSpoolDir(runtimeDir);
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl') && name !== 'feedback.jsonl')
    .map((name) => ({
      name,
      mtimeMs: statSync(join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return newest === undefined ? null : basename(newest.name, '.jsonl');
}

function defaultReadStdin(): string {
  if (process.stdin.isTTY === true) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function runProposeCommand(
  input: ProposeInput,
  options: ProposeOptions = {},
): { exitCode: 0 | ErrorExitCode; output: string } {
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();
  const readStdin = options.readStdin ?? defaultReadStdin;
  const body =
    input.body !== undefined && input.body.length > 0
      ? input.body
      : readStdin().trim();

  const candidate: Record<string, unknown> = {
    class: input.class,
    title: input.title,
    body,
    ...(input.tags === undefined || input.tags.length === 0
      ? {}
      : { tags: input.tags }),
  };

  // Same C1-linked linkage the distiller populates: cite the last session as
  // evidence when the spool has one (the "from the last session" in §4.2).
  const sid = latestSessionSid(runtimeDir);
  if (sid !== null) {
    candidate['evidence'] = { sessions: [sid], commits: [] };
  }

  const validation = candidateDraftSchema.safeParse(candidate);
  if (!validation.success) {
    const err = new ValidationError(
      `invalid candidate: ${formatZodIssues(validation.error)}`,
    );
    return {
      exitCode: exitCodeForError(err),
      output:
        `tb propose: ${err.message}\n` +
        '(required: --class decision|convention|map|learning, --title, and a body via --body or stdin)\n',
    };
  }

  const draft: CandidateDraft = validation.data;
  const spoolDir = candidateSpoolDir(runtimeDir);
  const candidateId = writeCandidate(
    spoolDir,
    draft,
    options.now ? options.now() : new Date(),
  );
  return {
    exitCode: 0,
    output:
      `Queued candidate ${candidateId} for human review.\n` +
      `  spool: ${join(spoolDir, `${candidateId}.json`)}\n` +
      (sid === null ? '' : `  evidence: session ${sid}\n`) +
      'It will surface in the next `tb distill` memory PR — nothing was written to the brain.\n',
  };
}
