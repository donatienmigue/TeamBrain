import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guardrail 4 (CLAUDE.md principle 3 / BUILD_PLAN standing guardrail): the
// product must never phone home. Runtime network egress is allowed in exactly
// three places — git (child_process, not scanned here), the LLM Provider
// (packages/distill/src/anthropic.ts), and the Slack webhook
// (packages/cli/src/digest/slack.ts). This test greps every package's shipped
// source for network APIs and fails on anything outside that allowlist, so a
// future module cannot add silent egress. Refs: AUDIT.md F3.

const PACKAGES_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Repo-relative (posix) files allowed to reach the network. */
const ALLOWED_EGRESS = new Set([
  'cli/src/digest/slack.ts', // digest → Slack webhook (guardrail-4 allowed)
  'distill/src/anthropic.ts', // C5 Provider driver (guardrail-4 allowed)
  // M3.2-mandated lazy embedding-model download (checksum-pinned, one-time,
  // to ~/.teambrain/models/). Guardrail 4's wording lists only three egress
  // points; M3.2 adds this fourth — recorded as AUDIT.md F8, documented in
  // SECURITY.md by I3. Any other file reaching the network is a violation.
  'index/src/embeddings.ts',
]);

/**
 * Network-egress syntax. Deliberately call/import-shaped so prose, injection
 * pattern strings ("fetch|curl"), and log messages never false-positive.
 */
const EGRESS_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'fetch call', regex: /\bfetch\s*\(/ },
  {
    name: 'node http/https import',
    regex: /(?:from\s+|require\(\s*)['"]node:https?['"]/,
  },
  {
    name: 'http client dependency',
    regex: /(?:from\s+|require\(\s*)['"](?:undici|axios|node-fetch|got|ky)['"]/,
  },
  { name: 'websocket', regex: /new\s+WebSocket\b|\bXMLHttpRequest\b/ },
  {
    name: 'anthropic sdk import',
    regex: /(?:from\s+|import\(\s*)['"]@anthropic-ai\//,
  },
];

/** Shipped source only: skip tests, test helpers, and bench harnesses. */
function isShippedSource(posixPath: string): boolean {
  return (
    posixPath.endsWith('.ts') &&
    !posixPath.endsWith('.test.ts') &&
    !posixPath.includes('/test-helpers') &&
    !posixPath.includes('/bench/')
  );
}

async function shippedSourceFiles(): Promise<string[]> {
  const entries = await readdir(PACKAGES_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(PACKAGES_DIR, join(entry.parentPath ?? '', entry.name))
        .split('\\')
        .join('/'),
    )
    .filter(
      (posixPath) =>
        /^[^/]+\/src\//.test(posixPath) && isShippedSource(posixPath),
    )
    .sort();
}

describe('guardrail 4: no network egress outside git/Provider/webhook (F3)', () => {
  it('scans a plausible amount of shipped source', async () => {
    // Guards the scanner itself: if the glob breaks and matches nothing,
    // the egress assertion below would pass vacuously.
    const files = await shippedSourceFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('cli/src/digest/slack.ts');
    expect(files).toContain('distill/src/anthropic.ts');
  });

  it('finds egress syntax only in the two allowlisted modules', async () => {
    const violations: string[] = [];
    const allowlistHits = new Set<string>();
    for (const posixPath of await shippedSourceFiles()) {
      const source = await readFile(join(PACKAGES_DIR, posixPath), 'utf8');
      for (const { name, regex } of EGRESS_PATTERNS) {
        if (!regex.test(source)) continue;
        if (ALLOWED_EGRESS.has(posixPath)) {
          allowlistHits.add(posixPath);
        } else {
          violations.push(`${posixPath}: ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // Negative-control: the allowlisted modules DO trip the patterns, so a
    // pattern-set regression can't silently neuter this test.
    expect([...allowlistHits].sort()).toEqual([...ALLOWED_EGRESS].sort());
  });
});
