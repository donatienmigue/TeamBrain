import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

// The release gates for the VSIX. Each of these encodes a decision that is
// cheap to hold and expensive to discover after publishing:
//
//   - native modules must never enter the bundle (better-sqlite3 and friends
//     are compiled against a Node ABI that Electron does not share, which
//     fails at activation and would force a platform-specific VSIX matrix);
//   - the extension must make no network calls of its own — TeamBrain's
//     privacy posture applies to its own telemetry, and an IDE extension is
//     exactly where analytics normally creep in;
//   - `vscode` is provided by the host and must stay external.

const packageRoot = new URL('..', import.meta.url);

async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/extension.ts', packageRoot))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    write: false,
    logLevel: 'silent',
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no output');
  return output.text;
}

describe('VSIX bundle', () => {
  it('bundles to CommonJS with `vscode` left external', async () => {
    const code = await bundle();
    expect(code).toContain('require("vscode")');
    expect(code).toContain('module.exports');
  });

  it('contains no native modules', async () => {
    const code = await bundle();
    for (const native of [
      'better-sqlite3',
      'sqlite-vec',
      'fastembed',
      'onnxruntime',
      'node-gyp-build',
      '.node"',
    ]) {
      expect(code).not.toContain(native);
    }
  });

  it('makes no network calls and ships no telemetry', async () => {
    const code = await bundle();
    for (const egress of [
      'fetch(',
      'require("node:http")',
      'require("node:https")',
      'require("node:net")',
      'require("http")',
      'require("https")',
      'XMLHttpRequest',
      'WebSocket',
      'createTelemetryLogger',
      'TelemetryReporter',
    ]) {
      expect(code).not.toContain(egress);
    }
  });

  it('spawns nothing itself — the MCP server is started by the host', async () => {
    // VS Code owns the child process lifecycle for stdio MCP servers. An
    // extension-side spawn would be a second, unmanaged copy of the daemon.
    const code = await bundle();
    expect(code).not.toContain('child_process');
  });
});

describe('extension manifest', () => {
  async function manifest(): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(new URL('package.json', packageRoot), 'utf8'),
    ) as Record<string, unknown>;
  }

  it('declares no runtime dependencies — nothing but the bundle ships', async () => {
    expect((await manifest())['dependencies']).toBeUndefined();
  });

  it('pins @types/vscode to the engine floor so the API cannot outrun it', async () => {
    const pkg = await manifest();
    const engines = pkg['engines'] as { vscode: string };
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(engines.vscode).toBe('^1.102.0');
    expect(devDeps['@types/vscode']).toBe('1.102.0');
  });

  it('points `main` at the bundled CommonJS entry', async () => {
    expect((await manifest())['main']).toBe('./out/extension.cjs');
  });

  it('contributes the provider id the extension registers', async () => {
    const pkg = await manifest();
    const providers = (pkg['contributes'] as Record<string, unknown>)[
      'mcpServerDefinitionProviders'
    ] as Array<{ id: string }>;
    expect(providers.map((p) => p.id)).toEqual(['teambrain.mcp']);
  });
});

describe('.vscodeignore', () => {
  it('keeps sources and node_modules out of the VSIX', async () => {
    const ignore = await readFile(
      new URL('.vscodeignore', packageRoot),
      'utf8',
    );
    for (const pattern of ['src/**', 'node_modules/**', 'dist/**']) {
      expect(ignore).toContain(pattern);
    }
  });
});
