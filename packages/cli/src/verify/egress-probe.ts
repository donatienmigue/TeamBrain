import net from 'node:net';
import { writeFileSync } from 'node:fs';

// E1/V2 egress probe. Preloaded via `node --import` ahead of the driver, it
// instruments the socket layer and records every outbound connection, writing
// the list to TB_EGRESS_OUT on exit.
//
// Why only net.Socket.connect: every JavaScript network path — http, https,
// global fetch/undici, ws — ultimately opens a net.Socket and calls connect().
// Patching one prototype catches them all WITHOUT importing node:http/https
// (which the egress guard flags) and without a global-fetch call site. OQ-8: sockets
// opened inside native modules (better-sqlite3, onnxruntime) are created below
// the JS layer and are invisible here — the report says so, and --strict is
// the OS-sandbox tier for a stronger guarantee.

const recorded: string[] = [];

function record(host: unknown, port: unknown): void {
  recorded.push(`${String(host)}:${String(port)}`);
}

function recordFromArgs(args: readonly unknown[]): void {
  // net.connect()/createConnection pass normalized args as a single array
  // `[options, cb]`; a direct socket.connect(options|port, ...) does not.
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { host?: unknown; port?: unknown; path?: unknown };
    record(o.host ?? o.path ?? '?', o.port ?? '');
  } else if (typeof first === 'number') {
    // connect(port[, host])
    record(args[1] ?? 'localhost', first);
  } else {
    record(first ?? '?', '');
  }
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  recordFromArgs(args);
  return originalConnect.apply(this, args as never);
} as typeof net.Socket.prototype.connect;

const outPath = process.env['TB_EGRESS_OUT'];
process.on('exit', () => {
  if (outPath === undefined) return;
  try {
    writeFileSync(outPath, JSON.stringify(recorded));
  } catch (err) {
    // Best-effort; the verifier treats a missing out-file as "could not run".
    process.stderr.write(`egress-probe: ${(err as Error).message}\n`);
  }
});
