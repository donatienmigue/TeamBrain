import type { BenchmarkReport } from './scorer.js';

// Publication discipline (E5.4): the report shows the system's OWN failures.
// A benchmark that only prints a perfect scorecard is not credible; the value
// is naming exactly which attack classes a system does and does not neutralise.

export function renderBenchmarkReport(report: BenchmarkReport): string {
  let md = `# inject-bench — ${report.system}\n\n`;
  md += `Corpus: ${report.total} payloads across ${Object.keys(report.byClass).length} attack classes. Tiers 1–2 are LLM-free.\n\n`;
  md += `- **Ingestion-block rate** (tier 1): ${pct(report.ingestionBlockRate)}\n`;
  md += `- **Containment rate** (tier 2, of stored payloads): ${pct(report.containmentRate)}\n`;
  md += `- **Safe rate** (blocked OR contained): **${pct(report.safeRate)}**\n\n`;

  md += `## By attack class\n\n`;
  md += `| class | safe / total |\n|---|---|\n`;
  for (const [cls, b] of Object.entries(report.byClass).sort()) {
    md += `| ${cls} | ${b.safe}/${b.total} |\n`;
  }

  const unsafe = report.cases.filter((c) => !c.safe);
  md += `\n## Unsafe cases\n\n`;
  md +=
    unsafe.length === 0
      ? `None — every payload was blocked at ingestion or served as inert data.\n`
      : unsafe
          .map(
            (c) =>
              `- \`${c.id}\` (${c.class}): neither blocked nor contained\n`,
          )
          .join('');
  return md;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
