import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDaemon,
  AUTOSTART_MAX_FAILURES,
  AUTOSTART_RETRY_COOLDOWN_MS,
} from './ensure-daemon.js';
import { daemonSocketPath } from './paths.js';

// Daemon auto-start unit tests. spawnDaemon/probe are always injected: these
// tests never spawn a real daemon and never touch the real ~/.teambrain.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempRuntimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-autostart-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Env sanitized per test: CI is set on real CI and would disable autostart. */
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ['TEAMBRAIN_NO_AUTOSTART', 'CI']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ['TEAMBRAIN_NO_AUTOSTART', 'CI']) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const PONG = { pid: 4242, doc_count: 1 };

/** A fake daemon that comes alive when spawnDaemon is called. */
function fakeCold(): {
  spawnCalls: () => number;
  spawnDaemon: () => void;
  probe: () => Promise<unknown | null>;
} {
  let alive = false;
  let calls = 0;
  return {
    spawnCalls: () => calls,
    spawnDaemon: (): void => {
      calls += 1;
      alive = true;
    },
    probe: (): Promise<unknown | null> => Promise.resolve(alive ? PONG : null),
  };
}

describe('ensureDaemon (auto-start core)', () => {
  it('warm path: returns true without spawning when the probe answers', async () => {
    const runtimeDir = await tempRuntimeDir();
    let spawned = 0;
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: () => {
        spawned += 1;
      },
      probe: () => Promise.resolve(PONG),
    });
    expect(result).toBe(true);
    expect(spawned).toBe(0);
  });

  it('cold start: spawns exactly once and returns true when the daemon answers', async () => {
    const runtimeDir = await tempRuntimeDir();
    const daemon = fakeCold();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
    });
    expect(result).toBe(true);
    expect(daemon.spawnCalls()).toBe(1);
  });

  it('race: 10 concurrent calls on a cold dir spawn exactly one daemon', async () => {
    const runtimeDir = await tempRuntimeDir();
    const daemon = fakeCold();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ensureDaemon({
          runtimeDir,
          enabled: true,
          spawnDaemon: daemon.spawnDaemon,
          probe: daemon.probe,
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 10 }, () => true));
    expect(daemon.spawnCalls()).toBe(1);
  });

  it.skipIf(platform() === 'win32')(
    'stale socket: an orphan socket file is unlinked before spawning',
    async () => {
      const runtimeDir = await tempRuntimeDir();
      const socketPath = daemonSocketPath(runtimeDir);
      await writeFile(socketPath, '', 'utf8');
      const daemon = fakeCold();
      let socketExistedAtSpawn: boolean | null = null;
      const result = await ensureDaemon({
        runtimeDir,
        enabled: true,
        spawnDaemon: (): void => {
          socketExistedAtSpawn = existsSync(socketPath);
          daemon.spawnDaemon();
        },
        probe: daemon.probe,
      });
      expect(result).toBe(true);
      expect(socketExistedAtSpawn).toBe(false);
    },
  );

  it('stale lock: a lock held by a dead pid is broken and spawn proceeds', async () => {
    const runtimeDir = await tempRuntimeDir();
    // A pid far beyond anything plausible on this machine: kill(pid, 0) throws.
    await writeFile(join(runtimeDir, 'daemon.lock'), '999999999\n', 'utf8');
    const daemon = fakeCold();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
    });
    expect(result).toBe(true);
    expect(daemon.spawnCalls()).toBe(1);
  });

  it('spawn failure: returns false and never throws', async () => {
    const runtimeDir = await tempRuntimeDir();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      deadlineMs: 150,
      spawnDaemon: (): void => {
        throw new Error('spawn exploded');
      },
      probe: () => Promise.resolve(null),
    });
    expect(result).toBe(false);
  });

  it('deadline: returns false roughly within the injected deadline', async () => {
    const runtimeDir = await tempRuntimeDir();
    const daemon = { spawned: 0 };
    const started = Date.now();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      deadlineMs: 120,
      spawnDaemon: (): void => {
        daemon.spawned += 1;
      },
      probe: () => Promise.resolve(null),
    });
    expect(result).toBe(false);
    expect(daemon.spawned).toBe(1);
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it('disabled by TEAMBRAIN_NO_AUTOSTART: probes once, never spawns', async () => {
    const runtimeDir = await tempRuntimeDir();
    process.env['TEAMBRAIN_NO_AUTOSTART'] = '1';
    let spawned = 0;
    let probes = 0;
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: () => {
        spawned += 1;
      },
      probe: (): Promise<unknown | null> => {
        probes += 1;
        return Promise.resolve(null);
      },
    });
    expect(result).toBe(false);
    expect(spawned).toBe(0);
    expect(probes).toBe(1);
  });

  it('disabled by CI: probes once, never spawns (alive daemon still reported)', async () => {
    const runtimeDir = await tempRuntimeDir();
    process.env['CI'] = '1';
    let spawned = 0;
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: () => {
        spawned += 1;
      },
      probe: () => Promise.resolve(PONG),
    });
    expect(result).toBe(true);
    expect(spawned).toBe(0);
  });

  it('disabled by option (config wiring): enabled=false never spawns', async () => {
    const runtimeDir = await tempRuntimeDir();
    let spawned = 0;
    const result = await ensureDaemon({
      runtimeDir,
      enabled: false,
      spawnDaemon: () => {
        spawned += 1;
      },
      probe: () => Promise.resolve(null),
    });
    expect(result).toBe(false);
    expect(spawned).toBe(0);
  });

  it('lock cleanup: daemon.lock never remains after success or failure', async () => {
    const lockLeft = async (
      run: (runtimeDir: string) => Promise<boolean>,
    ): Promise<boolean> => {
      const runtimeDir = await tempRuntimeDir();
      await run(runtimeDir);
      return existsSync(join(runtimeDir, 'daemon.lock'));
    };

    const daemon = fakeCold();
    expect(
      await lockLeft((runtimeDir) =>
        ensureDaemon({
          runtimeDir,
          enabled: true,
          spawnDaemon: daemon.spawnDaemon,
          probe: daemon.probe,
        }),
      ),
    ).toBe(false);

    expect(
      await lockLeft((runtimeDir) =>
        ensureDaemon({
          runtimeDir,
          enabled: true,
          deadlineMs: 100,
          spawnDaemon: (): void => {
            throw new Error('boom');
          },
          probe: () => Promise.resolve(null),
        }),
      ),
    ).toBe(false);
  });

  it('circuit breaker: after repeated failed starts, autostart stops spawning', async () => {
    const runtimeDir = await tempRuntimeDir();
    let spawned = 0;
    const lines: string[] = [];
    const failingAttempt = (): Promise<boolean> =>
      ensureDaemon({
        runtimeDir,
        enabled: true,
        deadlineMs: 60,
        spawnDaemon: () => {
          spawned += 1; // spawns, but the daemon never answers
        },
        probe: () => Promise.resolve(null),
        disclose: (line) => lines.push(line),
      });

    for (let i = 0; i < AUTOSTART_MAX_FAILURES; i += 1) {
      expect(await failingAttempt()).toBe(false);
    }
    expect(spawned).toBe(AUTOSTART_MAX_FAILURES);
    // The trip is disclosed exactly once…
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('autostart paused');

    // …and further calls are suppressed: no more spawns, still no throw.
    for (let i = 0; i < 5; i += 1) {
      expect(await failingAttempt()).toBe(false);
    }
    expect(spawned).toBe(AUTOSTART_MAX_FAILURES);
    expect(lines).toHaveLength(1);
  });

  it('circuit breaker: a throwing spawn counts as a failed attempt', async () => {
    const runtimeDir = await tempRuntimeDir();
    let spawnCalls = 0;
    const attempt = (): Promise<boolean> =>
      ensureDaemon({
        runtimeDir,
        enabled: true,
        deadlineMs: 60,
        spawnDaemon: (): void => {
          spawnCalls += 1;
          throw new Error('spawn exploded');
        },
        probe: () => Promise.resolve(null),
        disclose: () => undefined,
      });
    for (let i = 0; i < AUTOSTART_MAX_FAILURES + 3; i += 1) {
      expect(await attempt()).toBe(false);
    }
    expect(spawnCalls).toBe(AUTOSTART_MAX_FAILURES);
  });

  it('circuit breaker: cooldown expiry allows one fresh attempt, success resets it', async () => {
    const runtimeDir = await tempRuntimeDir();
    // A tripped breaker whose last failure is older than the cooldown.
    await writeFile(
      join(runtimeDir, 'autostart-failures.json'),
      `${JSON.stringify({
        failures: AUTOSTART_MAX_FAILURES,
        lastFailureAt: Date.now() - AUTOSTART_RETRY_COOLDOWN_MS - 1000,
      })}\n`,
      'utf8',
    );
    const daemon = fakeCold();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
      disclose: () => undefined,
    });
    expect(result).toBe(true);
    expect(daemon.spawnCalls()).toBe(1);
    // Success cleared the record: the breaker starts from zero again.
    expect(existsSync(join(runtimeDir, 'autostart-failures.json'))).toBe(false);
  });

  it('circuit breaker: within the cooldown a tripped breaker never spawns', async () => {
    const runtimeDir = await tempRuntimeDir();
    await writeFile(
      join(runtimeDir, 'autostart-failures.json'),
      `${JSON.stringify({
        failures: AUTOSTART_MAX_FAILURES,
        lastFailureAt: Date.now(),
      })}\n`,
      'utf8',
    );
    const daemon = fakeCold();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: () => Promise.resolve(null),
    });
    expect(result).toBe(false);
    expect(daemon.spawnCalls()).toBe(0);
  });

  it('circuit breaker: a corrupt failure record fails open (spawn proceeds)', async () => {
    const runtimeDir = await tempRuntimeDir();
    await writeFile(
      join(runtimeDir, 'autostart-failures.json'),
      '{definitely not json',
      'utf8',
    );
    const daemon = fakeCold();
    const result = await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
      disclose: () => undefined,
    });
    expect(result).toBe(true);
    expect(daemon.spawnCalls()).toBe(1);
  });

  it('disclosure: exactly one stderr line on cold start, none on warm', async () => {
    const runtimeDir = await tempRuntimeDir();
    const daemon = fakeCold();
    const lines: string[] = [];
    await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
      disclose: (line) => lines.push(line),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "TeamBrain: started local daemon (pid 4242). Stop with 'tb serve --stop'.\n",
    );

    // Warm second call: no further disclosure.
    await ensureDaemon({
      runtimeDir,
      enabled: true,
      spawnDaemon: daemon.spawnDaemon,
      probe: daemon.probe,
      disclose: (line) => lines.push(line),
    });
    expect(lines).toHaveLength(1);
  });
});
