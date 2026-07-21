import { createTools, openBackend } from '@teambrain/mcp';

// E1/V2 scripted session, run as a child under the egress probe. It drives the
// REAL serving path — open the index, sync the brain, render context, run a
// search — with embedder:null so nothing tries to download the model. The
// point is to prove that serving memories opens no JS-layer socket; any
// connection the probe records is a violation.

async function main(): Promise<void> {
  const runtimeDir = process.env['TB_VERIFY_RUNTIME'];
  const brainDir = process.env['TB_VERIFY_BRAIN'];
  if (runtimeDir === undefined || brainDir === undefined) {
    throw new Error('TB_VERIFY_RUNTIME and TB_VERIFY_BRAIN are required');
  }
  const handle = await openBackend({ runtimeDir, brainDir, embedder: null });
  try {
    const tools = createTools(handle.context);
    tools.memoryContext();
    await tools.memorySearch({ query: 'verify egress probe session', k: 8 });
  } finally {
    handle.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`egress-driver: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
