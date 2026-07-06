import type { z } from 'zod';

// C5 Provider interface — the distiller's only path to an LLM. "No LLM calls
// anywhere outside packages/distill" (CONTRACTS C5 / guardrail 4), so the
// interface lives here and every driver (anthropic, fake; openai/ollama
// deferred) implements it. Output is structured and zod-validated: complete()
// returns a valid `T` or throws — callers treat a throw as "discard".

export interface ProviderRequest<T> {
  /** System prompt (the versioned instructions). */
  system: string;
  /** User prompt (the per-call evidence). */
  prompt: string;
  /** zod schema the structured output must satisfy. */
  schema: z.ZodType<T>;
  /** Soft cap on output size; drivers may ignore. */
  maxTokens?: number;
}

export interface Provider {
  /** Stable driver id (for logs / audit). */
  readonly id: string;
  /**
   * Runs one structured completion. Resolves with schema-valid `T`, or rejects
   * if the model output is unusable (refusal, malformed, schema-invalid). The
   * draft stage counts a rejection as a discarded candidate.
   */
  complete<T>(request: ProviderRequest<T>): Promise<T>;
}
