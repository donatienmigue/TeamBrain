import { describe, expect, it } from 'vitest';
import { buildProgram } from './program.js';

function rootHelp(): string {
  const program = buildProgram();
  let out = '';
  program.configureOutput({
    writeOut: (text) => {
      out += text;
    },
    writeErr: () => {},
  });
  program.outputHelp();
  return out;
}

function commandHelp(name: string): string {
  const program = buildProgram();
  const cmd = program.commands.find((c) => c.name() === name);
  if (cmd === undefined) throw new Error(`unknown command: ${name}`);
  let out = '';
  cmd.configureOutput({
    writeOut: (text) => {
      out += text;
    },
    writeErr: () => {},
  });
  cmd.outputHelp();
  return out;
}

describe('cli help (M8.3)', () => {
  it('groups user-facing commands and documents exit codes', () => {
    const help = rootHelp();
    expect(help).toContain('Setup');
    expect(help).toContain('Daemon');
    expect(help).toContain('Capture');
    expect(help).toContain('Quality');
    expect(help).toContain('Exit codes:');
    expect(help).toContain('  3  lint / validation failure');
    expect(help).not.toContain('hook');
    expect(help).not.toMatch(/\bmcp\b/);
  });

  it('includes per-command examples for init and propose', () => {
    expect(commandHelp('init')).toContain('Examples:');
    expect(commandHelp('init')).toContain('teambrain/init');
    expect(commandHelp('propose')).toContain('echo "details..."');
    expect(commandHelp('propose')).toContain('Never writes to the brain');
  });

  it('documents all hook events even though hook is hidden from root help', () => {
    const help = commandHelp('hook');
    expect(help).toContain('post-tool-use');
    expect(help).toContain('session-end');
    expect(help).toContain('Always exits 0');
  });

  it('documents install targets and lint exit semantics', () => {
    expect(commandHelp('install')).toContain(
      'claude-code | codex | cursor | gemini-cli',
    );
    expect(commandHelp('lint')).toContain('Exit 3 on any violation');
  });
});
