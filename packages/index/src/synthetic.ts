import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  memoryPath,
  serializeMemoryFile,
  type Memory,
  type MemoryClass,
} from '@teambrain/core';

// M3.4 synthetic brain generator. Fully deterministic for a given seed so
// the golden-query fixture (testdata/golden-queries.yaml) can pin expected
// memory ids; a snapshot test guards against accidental drift.

export const SYNTHETIC_SEED = 42;
export const SYNTHETIC_COUNT = 5000;

/** mulberry32: tiny deterministic PRNG, plenty for fixture generation. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic ULID: first char 0-7 per the 48-bit timestamp cap. */
function deterministicUlid(random: () => number): string {
  let value = CROCKFORD.charAt(Math.floor(random() * 8));
  for (let i = 1; i < 26; i++) {
    value += CROCKFORD.charAt(Math.floor(random() * 32));
  }
  return value;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

// Filler vocabulary. Deliberately avoids the rare terms used by the golden
// topics below so golden queries have a unique lexical anchor.
const SERVICES = [
  'billing',
  'checkout',
  'catalog',
  'search-api',
  'notifications',
  'accounts',
  'payments',
  'inventory',
  'shipping',
  'reporting',
  'gateway',
  'scheduler',
  'importer',
  'exporter',
  'audit-log',
  'profile',
  'recommendations',
  'pricing',
  'orders',
  'sessions-svc',
] as const;

const ASPECTS = [
  'retries',
  'timeouts',
  'pagination',
  'caching',
  'logging',
  'migrations',
  'deploys',
  'configuration',
  'error handling',
  'validation',
  'authentication',
  'authorization',
  'monitoring',
  'alerting',
  'testing',
  'tracing',
  'queue consumption',
  'schema evolution',
  'connection pooling',
  'batch processing',
] as const;

const SENTENCES = [
  'The {service} service owns this behavior end to end.',
  'We agreed on this after the {service} outage in review.',
  'Any change here must update the {service} runbook first.',
  'Rollout happens behind a config toggle owned by the {service} team.',
  'The default settings proved wrong under production load.',
  'New endpoints must follow this rule from day one.',
  'Exceptions require a written note in the design doc.',
  'The {service} team measured a large improvement after adopting this.',
  'Integration coverage for this path lives next to the handler.',
  'On-call escalation for violations goes to the owning team.',
  'This applies to both the staging and production environments.',
  'The old approach caused duplicate work across {service} and its consumers.',
  'Keep the {aspect} settings in the shared configuration module.',
  'Document any deviation in the service readme before merging.',
  'The dashboard for {aspect} tracks the relevant error budget.',
  'Prefer the shared client library over hand-rolled calls.',
  'The limit was chosen from one quarter of production traffic data.',
  'Partial failures must surface as warnings, not silent drops.',
  'Reviews should reject changes that bypass this path.',
  'A follow-up cleanup is tracked for the legacy callers.',
] as const;

const TITLE_TEMPLATES = [
  '{Service} {aspect} standard',
  'How {service} handles {aspect}',
  '{Service} {aspect} decision',
  'Rules for {aspect} in {service}',
  '{Service} service {aspect} notes',
] as const;

const TAG_POOL = [
  'backend',
  'frontend',
  'infra',
  'process',
  'api',
  'database',
  'performance',
  'security',
  'ops',
  'ci',
] as const;

const CLASSES: readonly MemoryClass[] = [
  'decision',
  'convention',
  'convention',
  'map',
  'learning',
  'learning',
];

export interface GoldenTopic {
  key: string;
  title: string;
  body: string;
  /** The retrieval query the golden fixture pairs with this memory. */
  query: string;
  class: MemoryClass;
}

// 25 golden topics, each anchored by rare terms absent from the filler
// vocabulary. Queries are paraphrases sharing those anchors, not the titles.
export const GOLDEN_TOPICS: readonly GoldenTopic[] = [
  {
    key: 'exif-sidecar',
    title: 'Thumbnailer writes EXIF metadata to sidecar files',
    body: 'The thumbnail pipeline never rewrites original images. Extracted EXIF metadata is stored in a sidecar file next to the rendered thumbnail, one sidecar per source image. Consumers that need camera orientation or GPS fields must read the sidecar, not the binary. This keeps originals byte-identical for checksum audits.',
    query: 'where does exif metadata for thumbnails end up',
    class: 'convention',
  },
  {
    key: 'leap-second',
    title: 'Ingest tolerates leap-second clock skew',
    body: 'Event ingest orders records with a monotonic sequence number, not wall-clock time, because a leap second once produced out-of-order batches that broke downstream joins. Wall-clock timestamps are recorded for display only. Never compare event order using timestamps across hosts.',
    query: 'how do we deal with leap second skew during ingest',
    class: 'learning',
  },
  {
    key: 'protobuf-oneof',
    title: 'Avoid protobuf oneof in public event schemas',
    body: 'Public event schemas must not use protobuf oneof fields. Several consumer code generators mishandle oneof presence semantics, and schema evolution rules for oneof are easy to get wrong. Model mutually exclusive variants with an explicit type discriminator string field instead.',
    query: 'can I use a protobuf oneof field in an event schema',
    class: 'convention',
  },
  {
    key: 'redis-lua-bucket',
    title: 'Rate limiting is a Redis Lua token bucket',
    body: 'API rate limiting runs as a single Lua script in Redis implementing a token bucket per key. The script is atomic, so concurrent requests cannot double-spend tokens. Bucket size and refill rate come from the plan tier. Do not add application-side counters on top.',
    query: 'how is the redis lua token bucket rate limiter set up',
    class: 'map',
  },
  {
    key: 'canary-cookie',
    title: 'Canary deploys pin traffic with a sticky cookie',
    body: 'Canary releases route five percent of traffic by setting a sticky cookie at the edge, so a user stays on the canary for the whole session. Percentage-only routing caused flapping between versions mid-session and corrupted client caches. Widen the canary only after the sticky cohort is clean for an hour.',
    query: 'why do canary releases use a sticky cookie',
    class: 'decision',
  },
  {
    key: 'hnsw-recall',
    title: 'Vector search uses HNSW with recall spot-checks',
    body: 'Similarity search runs on an HNSW graph index. Build parameters were tuned for recall over latency, and a nightly job spot-checks recall against exact brute-force results on a sample. If nightly recall drops below the agreed floor, rebuild the graph before touching query-time parameters.',
    query: 'what checks recall of the hnsw graph index',
    class: 'map',
  },
  {
    key: 'parquet-partitions',
    title: 'Analytics exports are Parquet partitioned by day',
    body: 'All analytics exports land as Parquet files partitioned by event day, never by hour. Hourly partitions produced millions of tiny files and crushed the metadata store. Compaction merges late-arriving rows into the daily partition within forty-eight hours.',
    query: 'how are the parquet export files partitioned',
    class: 'convention',
  },
  {
    key: 'mtls-internal',
    title: 'Internal service calls require mTLS',
    body: 'Every service-to-service call inside the mesh uses mutual TLS with workload certificates rotated every twenty-four hours. Plaintext internal listeners are forbidden even on loopback. A sidecar handles the mTLS handshake, so application code never touches certificate files directly.',
    query: 'is mtls mandatory between internal services',
    class: 'decision',
  },
  {
    key: 'saml-clock',
    title: 'SAML logins fail closed on assertion clock drift',
    body: 'The SAML integration rejects assertions whose conditions window is outside a two-minute tolerance. A customer identity provider with a fast clock once minted assertions valid in the future, and accepting them created ghost sessions. Fail closed and surface a clear drift error to the admin.',
    query: 'what happens when a saml assertion has clock drift',
    class: 'learning',
  },
  {
    key: 'webauthn-fallback',
    title: 'WebAuthn is primary, TOTP is the only fallback',
    body: 'Second-factor authentication prefers WebAuthn passkeys. The only permitted fallback is TOTP; SMS codes were removed entirely after the SIM-swap incident review. Account recovery without either factor requires the manual support process with identity verification.',
    query: 'what is the fallback when webauthn is unavailable',
    class: 'decision',
  },
  {
    key: 'cron-jitter',
    title: 'All cron jobs add startup jitter',
    body: 'Scheduled jobs must sleep a random jitter of up to ten percent of their period before starting work. Synchronized cron starts caused thundering-herd load spikes against shared databases at the top of every hour. The shared scheduler library applies jitter automatically; do not disable it.',
    query: 'why do scheduled jobs sleep with random jitter first',
    class: 'convention',
  },
  {
    key: 'zstd-spool',
    title: 'Spool files are compressed with zstd level 3',
    body: 'Durable spool files are compressed with zstd at level three. Level nineteen halved storage but tripled CPU on the write path and delayed flushes past the latency budget. Level three keeps compression cheap while still cutting storage by roughly seventy percent.',
    query: 'which zstd level compresses the spool',
    class: 'decision',
  },
  {
    key: 'bloom-dedupe',
    title: 'Webhook dedupe uses a Bloom filter front',
    body: 'Incoming webhook ids pass through a Bloom filter before the exact-match store. The filter absorbs the overwhelmingly common new-id case with no database read. False positives fall through to the exact store, so delivery is never wrongly dropped; the filter only saves reads.',
    query: 'how does the bloom filter help webhook deduplication',
    class: 'map',
  },
  {
    key: 'jemalloc-fragmentation',
    title: 'Long-running workers use jemalloc',
    body: 'Resident memory of long-running workers grew without bound under the default allocator due to fragmentation from mixed allocation sizes. Switching to jemalloc flattened the curve. New long-running native services should link jemalloc from the start and export its stats endpoint.',
    query: 'which allocator fixed worker memory fragmentation',
    class: 'learning',
  },
  {
    key: 'tombstone-compaction',
    title: 'Deletes write tombstones compacted weekly',
    body: 'Row deletion in the ledger store writes a tombstone rather than removing data in place. A weekly compaction pass drops tombstoned rows older than the retention window. Readers must filter tombstones; skipping that filter once resurfaced deleted customer records in an export.',
    query: 'when are tombstones removed from the ledger',
    class: 'map',
  },
  {
    key: 'hyperloglog-uniques',
    title: 'Unique counts on dashboards are HyperLogLog',
    body: 'Dashboard unique-visitor numbers come from HyperLogLog sketches merged across shards, accurate to about two percent. Exact distinct counts are only computed in the warehouse for finance reports. Do not present sketch counts as exact figures in customer-facing UI.',
    query: 'are dashboard unique visitor numbers exact or hyperloglog',
    class: 'convention',
  },
  {
    key: 'circuit-halfopen',
    title: 'Circuit breakers use bounded half-open probes',
    body: 'Outbound dependency calls sit behind circuit breakers. After tripping, the breaker admits a small fixed number of half-open probe requests; unbounded probing during recovery once re-toppled a struggling dependency. Probe counts and cool-down windows live in the shared resilience config.',
    query: 'how many probes run while a circuit breaker is half open',
    class: 'map',
  },
  {
    key: 'saga-refunds',
    title: 'Refund flows are sagas with compensations',
    body: 'Refunds span the payment provider, the ledger, and notifications, coordinated as a saga: each step has an explicit compensation action, and a stalled saga alarms after fifteen minutes. Two-phase commit across those systems is not available. Never mutate refund state outside the saga runner.',
    query: 'how do refund compensations get coordinated',
    class: 'map',
  },
  {
    key: 'backpressure-lag',
    title: 'Consumers shed load on backpressure signals',
    body: 'Stream consumers watch partition lag as the backpressure signal. When lag crosses the threshold, consumers shed optional enrichment work first and only then slow intake. Buffering unboundedly in memory is forbidden; it converted a lag incident into an out-of-memory cascade once.',
    query: 'what do consumers shed first under backpressure',
    class: 'learning',
  },
  {
    key: 'vector-clock-presence',
    title: 'Presence state merges with vector clocks',
    body: 'The presence service reconciles concurrent status updates from multiple devices using vector clocks per user. Last-writer-wins by timestamp lost updates when device clocks disagreed. On conflicting concurrent writes the merge prefers the online status to avoid showing a connected user as away.',
    query: 'how does presence resolve concurrent device updates',
    class: 'map',
  },
  {
    key: 'merkle-backup',
    title: 'Backup verification compares Merkle roots',
    body: 'Nightly backups are verified by computing a Merkle tree over chunk hashes and comparing the root against the source snapshot. A full byte-for-byte restore test runs monthly. A silent bit flip in the object store was caught only because the Merkle root diverged.',
    query: 'how do we verify backups without a full restore',
    class: 'map',
  },
  {
    key: 'quic-fallback',
    title: 'Mobile clients try QUIC then fall back to TCP',
    body: 'Mobile API clients attempt QUIC first and race a TCP connection after a short delay, taking whichever completes. Several corporate networks block UDP entirely, so QUIC-only was never an option. Connection preferences are cached per network so the race is not repeated every request.',
    query: 'what happens on networks that block quic',
    class: 'decision',
  },
  {
    key: 'wasm-sandbox',
    title: 'Customer plugins run in a WASM sandbox',
    body: 'Customer-authored transformation plugins execute inside a WASM sandbox with a fixed memory ceiling, an instruction budget, and no ambient filesystem or network capability. Host functions expose exactly the allowed operations. Native plugin execution was rejected on isolation grounds.',
    query: 'how are customer plugins isolated from the host',
    class: 'decision',
  },
  {
    key: 'dlq-replay',
    title: 'Dead letter queues replay through the same consumer',
    body: 'Messages that exhaust retries land in a dead letter queue with the failure reason attached. Replays go through the original consumer code path, never a bespoke replay script; a hand-written replay once bypassed validation and wrote malformed rows. The DLQ drains only by explicit operator action.',
    query: 'how should dead letter queue messages be replayed',
    class: 'convention',
  },
  {
    key: 'killswitch-flags',
    title: 'Every risky feature ships with a kill switch flag',
    body: 'Features that touch money movement or data deletion must ship behind a kill switch flag that disables them within one configuration push, without a deploy. Kill switches are tested in staging monthly; an untested switch failed to disable a bad rollout once. Flag names use the killswitch prefix.',
    query: 'which features need a kill switch flag',
    class: 'convention',
  },
] as const;

export interface SyntheticBrain {
  memories: Memory[];
  /** Golden memory id per topic key, for the golden-queries fixture. */
  goldenIds: Record<string, string>;
}

export interface SyntheticBrainOptions {
  seed?: number;
  count?: number;
}

export function generateSyntheticBrain(
  options: SyntheticBrainOptions = {},
): SyntheticBrain {
  const seed = options.seed ?? SYNTHETIC_SEED;
  const count = options.count ?? SYNTHETIC_COUNT;
  const random = mulberry32(seed);
  const usedIds = new Set<string>();

  const nextId = (): string => {
    let id = deterministicUlid(random);
    while (usedIds.has(id)) id = deterministicUlid(random);
    usedIds.add(id);
    return id;
  };

  const nextCreated = (): string => {
    const year = 2024 + Math.floor(random() * 3);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 28);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const fillerMemory = (): Memory => {
    const service = pick(random, SERVICES);
    const aspect = pick(random, ASPECTS);
    const title = pick(random, TITLE_TEMPLATES)
      .replace('{Service}', service.charAt(0).toUpperCase() + service.slice(1))
      .replace('{service}', service)
      .replace('{aspect}', aspect);
    const sentenceCount = 4 + Math.floor(random() * 5);
    const sentences: string[] = [
      `This covers ${aspect} for the ${service} service.`,
    ];
    for (let i = 0; i < sentenceCount; i++) {
      sentences.push(
        pick(random, SENTENCES)
          .replaceAll('{service}', pick(random, SERVICES))
          .replaceAll('{aspect}', pick(random, ASPECTS)),
      );
    }
    const statusRoll = random();
    const ttlRoll = random();
    const priorityRoll = random();
    const tagCount = 1 + Math.floor(random() * 3);
    const tags = [
      ...new Set(
        Array.from({ length: tagCount }, () => pick(random, TAG_POOL)),
      ),
    ];
    return {
      id: nextId(),
      class: pick(random, CLASSES),
      scope: random() < 0.9 ? 'team' : 'org',
      status: statusRoll < 0.03 ? 'retired' : 'active',
      priority: priorityRoll < 0.005 ? 'required' : 'advisory',
      title: title.slice(0, 80),
      created: nextCreated(),
      supersedes: [],
      tags,
      // 2% carry a short TTL; with 2024-2026 created dates many of those
      // are expired by "now", exercising the TTL filter under load.
      ttl_days: ttlRoll < 0.02 ? 30 + Math.floor(random() * 60) : null,
      body: sentences.join(' '),
    };
  };

  // Golden memories occupy deterministic slots spread through the corpus.
  const goldenSlots = new Map<number, GoldenTopic>();
  GOLDEN_TOPICS.forEach((topic, index) => {
    goldenSlots.set(37 + index * 193, topic);
  });

  const memories: Memory[] = [];
  const goldenIds: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const topic = goldenSlots.get(i);
    if (topic !== undefined) {
      const memory: Memory = {
        id: nextId(),
        class: topic.class,
        scope: 'team',
        status: 'active',
        priority: 'advisory',
        title: topic.title,
        created: nextCreated(),
        supersedes: [],
        tags: ['golden'],
        ttl_days: null,
        body: topic.body,
      };
      goldenIds[topic.key] = memory.id;
      memories.push(memory);
    } else {
      memories.push(fillerMemory());
    }
  }
  return { memories, goldenIds };
}

/** Writes the brain as real C1 memory files under `<brainDir>/memories/`. */
export async function writeSyntheticBrain(
  brainDir: string,
  memories: readonly Memory[],
): Promise<void> {
  const madeDirs = new Set<string>();
  for (const memory of memories) {
    const filePath = join(brainDir, memoryPath(memory));
    const parent = dirname(filePath);
    if (!madeDirs.has(parent)) {
      await mkdir(parent, { recursive: true });
      madeDirs.add(parent);
    }
    await writeFile(filePath, serializeMemoryFile(memory), 'utf8');
  }
}
