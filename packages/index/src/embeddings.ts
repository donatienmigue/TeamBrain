import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extract as tarExtract } from 'tar';
import { EnvironmentError, type Logger } from '@teambrain/core';

// M3.2 embeddings. The real driver is fastembed's bge-small ONNX model,
// lazily downloaded to ~/.teambrain/models/ and pinned by checksum. Tests
// and bench use the deterministic HashingEmbedder: no network, no native
// ONNX runtime, stable across platforms.

export const EMBED_BATCH_SIZE = 64;

export interface Embedder {
  /** Stable identifier, stored in index meta to detect embedder changes. */
  readonly id: string;
  readonly dim: number;
  /** Embeds document bodies; implementations batch internally (64). */
  embedDocs(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface ModelSpec {
  /** fastembed model name; doubles as the directory and tarball name. */
  model: string;
  dim: number;
  tarballUrl: string;
  tarballSha256: string;
  /** Pinned sha256 per extracted file (relative to the model directory). */
  fileSha256: Record<string, string>;
}

// Pins computed from the artifact fastembed@2.1.0 downloads for
// EmbeddingModel.BGESmallENV15 (GCS object last modified 2023-10-16).
export const BGE_SMALL_EN_V15: ModelSpec = {
  model: 'fast-bge-small-en-v1.5',
  dim: 384,
  tarballUrl:
    'https://storage.googleapis.com/qdrant-fastembed/fast-bge-small-en-v1.5.tar.gz',
  tarballSha256:
    '3858004b3822f64f940280874b8f2d2dc25b34a4f3eb3cdf617bdceeb21ed9ed',
  fileSha256: {
    'model_optimized.onnx':
      '20e3bd678b8e67a722f151f3ee1e3827fc3f230839c0d57c025a3753cefa6b2e',
    'tokenizer.json':
      'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66',
  },
};

export function defaultModelsDir(): string {
  return join(homedir(), '.teambrain', 'models');
}

export function l2Normalize(vector: Float32Array): Float32Array {
  let sumOfSquares = 0;
  for (const component of vector) sumOfSquares += component * component;
  if (sumOfSquares === 0) return vector;
  const inverseNorm = 1 / Math.sqrt(sumOfSquares);
  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = (vector[i] as number) * inverseNorm;
  }
  return normalized;
}

// --- deterministic hashing embedder (tests + bench) ---

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Bag-of-words feature hashing: each unigram and adjacent bigram hashes to
 * one of `dim` buckets with sign, then the vector is L2-normalized. Purely
 * lexical, but that is exactly what makes it a deterministic, offline
 * stand-in that still exercises the whole vector path (vec0 storage, KNN,
 * rank fusion) with meaningful neighbor structure.
 */
export class HashingEmbedder implements Embedder {
  readonly id: string;
  readonly dim: number;

  constructor(dim = 384) {
    this.dim = dim;
    this.id = `hashing-v1-${dim}`;
  }

  private embedOne(text: string): Float32Array {
    const vector = new Float32Array(this.dim);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const addFeature = (feature: string): void => {
      const hash = fnv1a(feature);
      const bucket = hash % this.dim;
      vector[bucket] =
        (vector[bucket] as number) + (hash & 0x80000000 ? -1 : 1);
    };
    for (let i = 0; i < tokens.length; i++) {
      addFeature(tokens[i] as string);
      if (i + 1 < tokens.length) {
        addFeature(`${tokens[i]} ${tokens[i + 1]}`);
      }
    }
    return l2Normalize(vector);
  }

  embedDocs(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  embedQuery(text: string): Promise<Float32Array> {
    return Promise.resolve(this.embedOne(text));
  }
}

// --- fastembed driver ---

export type DownloadFn = (url: string, destPath: string) => Promise<void>;

function httpsDownload(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(
          new EnvironmentError(
            `model download failed: HTTP ${response.statusCode} from ${url}`,
          ),
        );
        return;
      }
      const fileStream = createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(() => resolve()));
      fileStream.on('error', reject);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function sha256OfFile(filePath: string): Promise<string> {
  // Model files are ≤~130MB; a whole-file read at startup is acceptable.
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface EnsureModelOptions {
  modelsDir: string;
  spec?: ModelSpec;
  /** When false, a missing model is an error instead of a download. */
  allowDownload?: boolean;
  /** Injectable downloader for tests. */
  download?: DownloadFn;
}

/**
 * Guarantees `<modelsDir>/<model>/` exists and matches the checksum pins.
 * Downloads the tarball lazily; the tarball hash is verified BEFORE
 * extraction so unpinned bytes are never unpacked, and the extracted files
 * are verified before anything loads them into the ONNX runtime.
 * Throws EnvironmentError on any failure (callers degrade, principle 2).
 */
export async function ensureModelFiles(
  options: EnsureModelOptions,
): Promise<string> {
  const spec = options.spec ?? BGE_SMALL_EN_V15;
  const modelDir = join(options.modelsDir, spec.model);
  const pinnedFiles = Object.entries(spec.fileSha256);
  const firstPinnedFile = pinnedFiles[0]?.[0];

  const modelPresent =
    firstPinnedFile !== undefined &&
    (await fileExists(join(modelDir, firstPinnedFile)));

  if (!modelPresent) {
    if (options.allowDownload === false) {
      throw new EnvironmentError(
        `embedding model absent at ${modelDir} and download disabled`,
      );
    }
    await mkdir(options.modelsDir, { recursive: true });
    const tarballPath = join(options.modelsDir, `${spec.model}.tar.gz`);
    const partialPath = `${tarballPath}.partial`;
    const download = options.download ?? httpsDownload;
    try {
      await download(spec.tarballUrl, partialPath);
      const actualTarballHash = await sha256OfFile(partialPath);
      if (actualTarballHash !== spec.tarballSha256) {
        throw new EnvironmentError(
          `model tarball checksum mismatch for ${spec.model}: ` +
            `expected ${spec.tarballSha256}, got ${actualTarballHash}`,
        );
      }
      await rename(partialPath, tarballPath);
      await tarExtract({ file: tarballPath, cwd: options.modelsDir });
    } finally {
      await rm(partialPath, { force: true });
      await rm(tarballPath, { force: true });
    }
  }

  for (const [fileName, expectedHash] of pinnedFiles) {
    const filePath = join(modelDir, fileName);
    if (!(await fileExists(filePath))) {
      throw new EnvironmentError(
        `embedding model file missing after ensure: ${filePath}`,
      );
    }
    const actualHash = await sha256OfFile(filePath);
    if (actualHash !== expectedHash) {
      throw new EnvironmentError(
        `embedding model checksum mismatch for ${fileName}: ` +
          `expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }
  return modelDir;
}

export interface FastEmbedOptions extends Omit<EnsureModelOptions, 'spec'> {
  spec?: ModelSpec;
}

/**
 * Real embedder: fastembed bge-small over the pinned local model.
 * Throws EnvironmentError when the model cannot be made available.
 */
export async function createFastEmbedEmbedder(
  options: FastEmbedOptions,
): Promise<Embedder> {
  const spec = options.spec ?? BGE_SMALL_EN_V15;
  await ensureModelFiles({ ...options, spec });

  // Dynamic import: fastembed drags in onnxruntime-node; nothing that runs
  // lexical-only (or any test) should pay that native-module load.
  let flagEmbedding;
  try {
    const fastembed = await import('fastembed');
    const modelEnumValue = Object.values(fastembed.EmbeddingModel).find(
      (value) =>
        value === spec.model && value !== fastembed.EmbeddingModel.CUSTOM,
    );
    if (modelEnumValue === undefined) {
      throw new EnvironmentError(
        `model ${spec.model} is not a fastembed standard model`,
      );
    }
    flagEmbedding = await fastembed.FlagEmbedding.init({
      model: modelEnumValue as Exclude<
        typeof modelEnumValue,
        typeof fastembed.EmbeddingModel.CUSTOM
      >,
      cacheDir: options.modelsDir,
      showDownloadProgress: false,
    });
  } catch (err) {
    throw new EnvironmentError(
      `fastembed initialization failed: ${(err as Error).message}`,
      { cause: err },
    );
  }
  const engine = flagEmbedding;

  return {
    id: `fastembed-${spec.model}`,
    dim: spec.dim,
    async embedDocs(texts: string[]): Promise<Float32Array[]> {
      const vectors: Float32Array[] = [];
      for await (const batch of engine.embed(texts, EMBED_BATCH_SIZE)) {
        for (const embedding of batch) {
          vectors.push(l2Normalize(Float32Array.from(embedding)));
        }
      }
      return vectors;
    },
    async embedQuery(text: string): Promise<Float32Array> {
      const embedding = await engine.queryEmbed(text);
      return l2Normalize(Float32Array.from(embedding));
    },
  };
}

/**
 * Degrading wrapper: returns null instead of throwing so callers fall back
 * to lexical-only search, logging the reason at debug level (principle 2).
 */
export async function tryCreateFastEmbedEmbedder(
  options: FastEmbedOptions & { logger?: Logger },
): Promise<Embedder | null> {
  try {
    return await createFastEmbedEmbedder(options);
  } catch (err) {
    options.logger?.debug(
      'embedding model unavailable; degrading to lexical-only retrieval',
      { reason: (err as Error).message },
    );
    return null;
  }
}
