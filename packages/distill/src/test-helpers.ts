import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseSessionEventLine, type SessionEvent } from '@teambrain/core';
import type { SessionRecord } from './types.js';
import type { SessionSource } from './sessions.js';
import type { EmbedFn } from './dedup.js';

// Shared test utilities (not exported from the package).

export function event(
  sid: string,
  ev: SessionEvent['ev'],
  data: Record<string, unknown>,
): SessionEvent {
  return {
    v: 1,
    sid,
    t: '2026-07-05T12:00:00.000Z',
    tool: 'claude-code',
    model: 'claude-opus-4-8',
    repo: 'acme/api',
    branch: 'main',
    ev,
    data,
  } as SessionEvent;
}

export function edit(sid: string, path: string): SessionEvent {
  return event(sid, 'tool_use', { kind: 'edit', path });
}

export function command(
  sid: string,
  exitCode: number,
  kind: 'command' | 'test' = 'command',
): SessionEvent {
  return event(sid, 'tool_use', { kind, exit_code: exitCode });
}

export function noHit(sid: string): SessionEvent {
  return event(sid, 'memory_retrieved', { ids: [] });
}

export function proposed(sid: string, title: string): SessionEvent {
  return event(sid, 'candidate_proposed', {
    draft: { class: 'learning', title, body: `Body for ${title}.` },
  });
}

export function record(
  sid: string,
  events: SessionEvent[],
  commitShas: string[] = [],
): SessionRecord {
  return { sid, events, commitShas };
}

/** Parses one on-disk `.jsonl` session record into a SessionRecord. */
function parseRecordFile(sid: string, content: string): SessionRecord {
  const events: SessionEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    events.push(parseSessionEventLine(line));
  }
  const commitShas = [
    ...new Set(
      events.flatMap((e) =>
        e.ev === 'session_end'
          ? (e.data as { commit_shas: string[] }).commit_shas
          : [],
      ),
    ),
  ];
  const first = events[0];
  return {
    sid,
    events,
    commitShas,
    ...(first === undefined ? {} : { repo: first.repo, branch: first.branch }),
  };
}

/**
 * A SessionSource backed by a directory of `.jsonl` fixture files — lets the
 * golden pipeline test read the real fixture records without a git branch.
 */
export function fixtureSessionSource(sessionsDir: string): SessionSource {
  const load = (): SessionRecord[] =>
    readdirSync(sessionsDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .map((name) =>
        parseRecordFile(
          basename(name, '.jsonl'),
          readFileSync(join(sessionsDir, name), 'utf8'),
        ),
      );
  return {
    head: () => 'fixture-head',
    readNewRecords: () => load(),
  };
}

/**
 * Deterministic bag-of-words (unigram + adjacent bigram) hashing embedder,
 * matching the index's HashingEmbedder shape without pulling in better-sqlite3.
 * L2-normalized, so cosine over its output is meaningful for dedup tests.
 */
export function lexicalEmbedder(dim = 512): EmbedFn {
  const fnv1a = (text: string): number => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };
  const embedOne = (text: string): Float32Array => {
    const vector = new Float32Array(dim);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const add = (feature: string): void => {
      const hash = fnv1a(feature);
      const bucket = hash % dim;
      vector[bucket] =
        (vector[bucket] as number) + (hash & 0x80000000 ? -1 : 1);
    };
    for (let i = 0; i < tokens.length; i++) {
      add(tokens[i] as string);
      if (i + 1 < tokens.length) add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    let sum = 0;
    for (const c of vector) sum += c * c;
    if (sum > 0) {
      const inv = 1 / Math.sqrt(sum);
      for (let i = 0; i < dim; i++) vector[i] = (vector[i] as number) * inv;
    }
    return vector;
  };
  return (texts) => Promise.resolve(texts.map(embedOne));
}
