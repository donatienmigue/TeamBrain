import type { SessionEvent } from '@teambrain/core';
import type { HookContext } from './map.js';

// A0.1 the CaptureAdapter framework (Adapters Tech Brief §3.1). A vendor
// integration is exactly three things: a payload mapper, an install plan,
// and a capabilities declaration. Envelope construction, sid handling,
// deny-globs, redaction, the fire-and-forget socket, the <20ms budget and
// exit-0-always all stay in the shared path and are never per-vendor.

/**
 * How a vendor's activity is captured:
 * - `native-hooks`: the tool fires lifecycle/tool hooks that run a command
 *   (Claude Code's model) — full session_start/tool_use/session_end.
 * - `mcp-inference`: no hooks; session boundaries inferred from MCP tool
 *   calls + idle timeout (Cursor's model) — no tool_use events.
 * - `serving-only`: the agent speaks MCP but exposes nothing to hook.
 */
export type CaptureTier = 'native-hooks' | 'mcp-inference' | 'serving-only';

/** What this adapter can honestly capture. Drives `tb doctor` and the README matrix. */
export interface CaptureCapabilities {
  sessionStart: boolean;
  sessionEnd: boolean;
  /** edits/commands/tests/exploration */
  toolUse: boolean;
  /** can session_end carry commit SHAs + a real outcome? */
  commitShas: boolean;
  planRevision: boolean;
}

export interface MergeResult {
  value: Record<string, unknown>;
  changed: boolean;
}

export interface TextMergeResult {
  value: string;
  changed: boolean;
}

/**
 * One file `tb install` maintains for an adapter. Merges are pure — that is
 * what keeps the idempotent-install promise ("run twice → zero diff").
 */
export type InstallFile =
  | {
      label: string;
      /** Absolute target path (installPlan joins it under projectDir). */
      path: string;
      format: 'json';
      merge: (existing: Record<string, unknown>) => MergeResult;
    }
  | {
      label: string;
      path: string;
      format: 'text';
      merge: (existing: string) => TextMergeResult;
    };

export interface CaptureAdapter {
  /** Registry key and C2 envelope `tool` value ('claude-code', 'cursor', …). */
  readonly tool: string;
  /** Human name for docs/doctor output ('Claude Code'). */
  readonly displayName: string;
  readonly tier: CaptureTier;
  readonly capabilities: CaptureCapabilities;

  /**
   * Vendor payload → C2 event (or null when the payload isn't an event).
   * The privacy contract lives here: mappers must structurally drop content
   * fields (diffs, prompts, command text) — never read them into events.
   */
  mapEvent(raw: unknown, ctx: HookContext): SessionEvent | null;

  /** Files the installer writes (pure merges; enables idempotent install). */
  installPlan(projectDir: string): InstallFile[];

  /** What `tb doctor` should say about this tool's capture level. */
  describeDegradation(): string;
}
