import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentError } from '@teambrain/core';
import {
  EMBED_BATCH_SIZE,
  HashingEmbedder,
  ensureModelFiles,
  l2Normalize,
  tryCreateFastEmbedEmbedder,
  type DownloadFn,
  type ModelSpec,
} from './embeddings.js';
import { captureLogger } from './test-helpers.js';

describe('HashingEmbedder', () => {
  const embedder = new HashingEmbedder();

  it('produces unit-norm vectors of the requested dim', async () => {
    expect(embedder.dim).toBe(384);
    const [vector] = await embedder.embedDocs(['redis token bucket']);
    expect(vector).toHaveLength(384);
    let norm = 0;
    for (const component of vector as Float32Array) norm += component ** 2;
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic and case/punctuation-insensitive', async () => {
    const [a] = await embedder.embedDocs(['Redis, token bucket!']);
    const b = await embedder.embedQuery('redis token bucket');
    expect([...(a as Float32Array)]).toEqual([...b]);
  });

  it('places lexically similar texts closer than dissimilar ones', async () => {
    const [base, near, far] = await embedder.embedDocs([
      'webhook delivery retries with exponential backoff',
      'webhook retries use exponential backoff and jitter',
      'quarterly finance report for the board meeting',
    ]);
    const cosine = (x: Float32Array, y: Float32Array): number => {
      let dot = 0;
      for (let i = 0; i < x.length; i++) {
        dot += (x[i] as number) * (y[i] as number);
      }
      return dot;
    };
    expect(cosine(base as Float32Array, near as Float32Array)).toBeGreaterThan(
      cosine(base as Float32Array, far as Float32Array),
    );
  });

  it('embeds the empty string without NaNs', async () => {
    const vector = await embedder.embedQuery('');
    expect([...vector].every((component) => Number.isFinite(component))).toBe(
      true,
    );
  });
});

describe('l2Normalize', () => {
  it('normalizes and leaves the zero vector alone', () => {
    const normalized = l2Normalize(Float32Array.from([3, 4]));
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
    expect([...l2Normalize(new Float32Array(2))]).toEqual([0, 0]);
  });
});

describe('ensureModelFiles checksum pin (M3.2)', () => {
  let workDir: string;
  let tarballPath: string;
  let spec: ModelSpec;
  let download: DownloadFn;

  const sha256 = async (filePath: string): Promise<string> =>
    createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex');

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'tb-model-'));
    // Build a fake model tarball shaped like the real artifact.
    const stageDir = join(workDir, 'stage');
    const modelDir = join(stageDir, 'fake-model');
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, 'model_optimized.onnx'), 'onnx-bytes');
    await writeFile(join(modelDir, 'tokenizer.json'), '{"fake": true}');
    tarballPath = join(workDir, 'fake-model.tar.gz');
    await tarCreate({ gzip: true, file: tarballPath, cwd: stageDir }, [
      'fake-model',
    ]);
    spec = {
      model: 'fake-model',
      dim: 8,
      tarballUrl: 'https://example.invalid/fake-model.tar.gz',
      tarballSha256: await sha256(tarballPath),
      fileSha256: {
        'model_optimized.onnx': createHash('sha256')
          .update('onnx-bytes')
          .digest('hex'),
        'tokenizer.json': createHash('sha256')
          .update('{"fake": true}')
          .digest('hex'),
      },
    };
    download = async (_url, destPath) => {
      await cp(tarballPath, destPath);
    };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('downloads, verifies the tarball pin, extracts, verifies file pins', async () => {
    const modelsDir = join(workDir, 'models');
    const modelDir = await ensureModelFiles({ modelsDir, spec, download });
    expect(modelDir).toBe(join(modelsDir, 'fake-model'));
    await expect(
      readFile(join(modelDir, 'model_optimized.onnx'), 'utf8'),
    ).resolves.toBe('onnx-bytes');
    // The tarball is cleaned up either way.
    await expect(
      readFile(join(modelsDir, 'fake-model.tar.gz')),
    ).rejects.toThrow();
  });

  it('skips the download when the pinned model is already present', async () => {
    const modelsDir = join(workDir, 'models');
    await ensureModelFiles({ modelsDir, spec, download });
    const spy = vi.fn<DownloadFn>();
    await ensureModelFiles({ modelsDir, spec, download: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a tarball whose checksum differs from the pin (before extracting)', async () => {
    const modelsDir = join(workDir, 'models');
    const badSpec = { ...spec, tarballSha256: '0'.repeat(64) };
    await expect(
      ensureModelFiles({ modelsDir, spec: badSpec, download }),
    ).rejects.toThrow(/tarball checksum mismatch/);
    // Nothing unverified was unpacked.
    await expect(
      readFile(join(modelsDir, 'fake-model', 'model_optimized.onnx')),
    ).rejects.toThrow();
    expect(
      await ensureModelFiles({ modelsDir, spec, download }).then(() => 'ok'),
    ).toBe('ok');
  });

  it('rejects a tampered extracted file', async () => {
    const modelsDir = join(workDir, 'models');
    await ensureModelFiles({ modelsDir, spec, download });
    await writeFile(
      join(modelsDir, 'fake-model', 'model_optimized.onnx'),
      'tampered',
    );
    await expect(
      ensureModelFiles({ modelsDir, spec, download }),
    ).rejects.toThrow(/checksum mismatch for model_optimized.onnx/);
  });

  it('errors when the model is absent and download is disabled', async () => {
    await expect(
      ensureModelFiles({
        modelsDir: join(workDir, 'models'),
        spec,
        allowDownload: false,
        download,
      }),
    ).rejects.toThrow(EnvironmentError);
  });
});

describe('offline degrade (principle 2)', () => {
  it('tryCreateFastEmbedEmbedder returns null and logs the reason at debug', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'tb-degrade-'));
    try {
      const logger = captureLogger();
      const embedder = await tryCreateFastEmbedEmbedder({
        modelsDir: join(workDir, 'models'),
        allowDownload: false,
        logger,
      });
      expect(embedder).toBeNull();
      const entry = logger.entries.find((candidate) =>
        candidate.msg.includes('lexical-only'),
      );
      expect(entry?.level).toBe('debug');
      expect(entry?.fields['reason']).toMatch(/download disabled/);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe('batch size constant', () => {
  it('is 64 per M3.2', () => {
    expect(EMBED_BATCH_SIZE).toBe(64);
  });
});
