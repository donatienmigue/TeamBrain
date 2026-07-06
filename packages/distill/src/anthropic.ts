import { EnvironmentError } from '@teambrain/core';
import type { Provider, ProviderRequest } from './provider.js';

// The real distiller driver: Anthropic Messages API with structured outputs.
// The SDK is imported lazily (dynamic import) so nothing that runs on the fake
// driver — every test, and `tb distill` against a fixture — pays the load, and
// the network dependency is contained to this one module (guardrail 4: LLM
// calls only in packages/distill). Default model per the "latest capable
// Claude" guidance; overridable via brain.yaml's `distill.model`.

export const DEFAULT_DISTILL_MODEL = 'claude-opus-4-8';

export interface AnthropicProviderOptions {
  /** Model id, pinned in brain.yaml. Defaults to the latest capable Opus. */
  model?: string;
  /** API key; the SDK otherwise resolves it from the environment. */
  apiKey?: string;
}

/** A Provider backed by the official Anthropic SDK + structured outputs. */
export function anthropicProvider(
  options: AnthropicProviderOptions = {},
): Provider {
  const model = options.model ?? DEFAULT_DISTILL_MODEL;
  return {
    id: `anthropic:${model}`,
    async complete<T>(request: ProviderRequest<T>): Promise<T> {
      const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
        import('@anthropic-ai/sdk'),
        import('@anthropic-ai/sdk/helpers/zod'),
      ]);

      const client = new Anthropic(
        options.apiKey === undefined ? {} : { apiKey: options.apiKey },
      );

      let response;
      try {
        response = await client.messages.parse({
          model,
          max_tokens: request.maxTokens ?? 1024,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: { format: zodOutputFormat(request.schema) },
        });
      } catch (err) {
        // Surfaced to the draft/conflict stage, which treats it as a discard.
        throw new EnvironmentError(
          `anthropic completion failed: ${(err as Error).message}`,
          { cause: err },
        );
      }

      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        // Refusal or unparseable output → no usable candidate.
        throw new EnvironmentError(
          `anthropic returned no structured output ` +
            `(stop_reason: ${response.stop_reason ?? 'unknown'})`,
        );
      }
      return parsed;
    },
  };
}
