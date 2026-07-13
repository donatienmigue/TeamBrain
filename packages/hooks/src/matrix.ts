import type {
  CaptureAdapter,
  CaptureCapabilities,
  CaptureTier,
} from './adapter.js';

// A0.4 the anti-overclaim matrix: the README's capture table is *generated*
// from ADAPTERS[*].capabilities and a CI test asserts the README matches this
// output byte-for-byte — so the docs cannot claim capture the code doesn't do.

export const MATRIX_START = '<!-- capture-matrix:start -->';
export const MATRIX_END = '<!-- capture-matrix:end -->';

const TIER_LABEL: Record<CaptureTier, string> = {
  'native-hooks': 'Native hooks',
  'mcp-inference': 'MCP-side inference',
  'serving-only': 'Serving only',
};

function cell(adapter: CaptureAdapter, cap: keyof CaptureCapabilities): string {
  if (!adapter.capabilities[cap]) return 'No';
  switch (adapter.tier) {
    case 'native-hooks':
      return 'Yes (native hook)';
    case 'mcp-inference':
      return 'Yes (MCP-side inference)';
    case 'serving-only':
      return 'Yes';
  }
}

/**
 * Renders the capture matrix as a markdown table, one column per adapter.
 * Every capability row is derived strictly from `adapter.capabilities`; the
 * two MCP-tool rows are 'Yes' for every registered adapter because
 * `installPlan` always registers the teambrain MCP server (serving is
 * universal — capture is what varies).
 */
export function renderCaptureMatrix(adapters: CaptureAdapter[]): string {
  const header = ['Capability', ...adapters.map((a) => a.displayName)];
  const rows: string[][] = [
    ['Install command', ...adapters.map((a) => `\`tb install ${a.tool}\``)],
    ['Capture tier', ...adapters.map((a) => TIER_LABEL[a.tier])],
    ['Session start', ...adapters.map((a) => cell(a, 'sessionStart'))],
    ['Session end', ...adapters.map((a) => cell(a, 'sessionEnd'))],
    [
      'Tool use (edits / commands / tests / exploration)',
      ...adapters.map((a) => cell(a, 'toolUse')),
    ],
    ['Commit SHAs & outcome', ...adapters.map((a) => cell(a, 'commitShas'))],
    ['Plan revisions', ...adapters.map((a) => cell(a, 'planRevision'))],
    ['Memory search / retrieve (MCP tool)', ...adapters.map(() => 'Yes')],
    ['Propose memory (MCP tool)', ...adapters.map(() => 'Yes')],
  ];
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join(
    '\n',
  );
}
