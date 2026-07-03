// M1.2 injection heuristics. Memory bodies are data, never agent
// instructions (C3 rendering rule); `tb lint` rejects bodies that read
// as instructions to an agent. Heuristic by design: extend this table
// rather than special-casing callers, and give every entry one positive
// and one negative case in injection-patterns.test.ts.

export interface InjectionPattern {
  /** Stable identifier surfaced in lint violation messages. */
  id: string;
  /** What the pattern is meant to catch, for reviewers. */
  description: string;
  pattern: RegExp;
}

export const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    id: 'ignore-previous',
    description: 'attempts to void earlier agent instructions',
    pattern: /ignore (all )?previous/i,
  },
  {
    id: 'disregard-instructions',
    description: 'attempts to void standing instructions or rules',
    // Bounded gap: "disregard ... rule" across a whole paragraph is
    // more likely coincidence than an instruction.
    pattern: /disregard .{0,120}(instruction|rule)/i,
  },
  {
    id: 'you-must-now',
    description: 'imperative redirection of agent behavior',
    pattern: /you must now/i,
  },
  {
    id: 'tool-invocation',
    description: 'MCP tool-invocation syntax',
    pattern: /mcp__/i,
  },
  {
    id: 'system-tag',
    description: 'raw system-style prompt tags',
    pattern: /<\/?(system|assistant|human|im_start|im_end)\b[^>]*>/i,
  },
  {
    id: 'fetch-imperative',
    description: 'instruction to pull and act on remote content',
    pattern: /\b(fetch|curl)\s+(-\S+\s+)*https?:\/\//i,
  },
];

export interface InjectionFinding {
  patternId: string;
  /** Matched text, whitespace-collapsed and capped for display. */
  excerpt: string;
}

const EXCERPT_MAX_LENGTH = 60;

/** Returns at most one finding per pattern, in table order. */
export function scanForInjection(text: string): InjectionFinding[] {
  // Memory bodies are hard-wrapped markdown, so a phrase like
  // "ignore all\nprevious" must still match: scan with whitespace
  // collapsed, which also lets table entries use plain spaces.
  const normalizedText = text.replace(/\s+/g, ' ');
  const findings: InjectionFinding[] = [];
  for (const { id, pattern } of INJECTION_PATTERNS) {
    const match = pattern.exec(normalizedText);
    if (match) {
      findings.push({
        patternId: id,
        excerpt: match[0].slice(0, EXCERPT_MAX_LENGTH),
      });
    }
  }
  return findings;
}
