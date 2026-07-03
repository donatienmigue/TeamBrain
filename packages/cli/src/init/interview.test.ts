import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lintMemoryText,
  memoryPath,
  serializeMemoryFile,
  ulid,
  type Memory,
} from '@teambrain/core';
import { importRepo } from './convert.js';
import {
  MAX_INTERVIEW_QUESTIONS,
  answersToMemories,
  generateInterviewQuestions,
  runInterview,
  type InterviewQuestion,
} from './interview.js';

const REPOS_DIR = fileURLToPath(
  new URL('../../../../testdata/repos', import.meta.url),
);

function convention(
  title: string,
  source: string,
  body = 'Some rule.',
): Memory {
  return {
    id: ulid(),
    class: 'convention',
    scope: 'team',
    status: 'active',
    priority: 'advisory',
    title,
    created: '2026-07-03',
    supersedes: [],
    tags: ['imported', `source:${source}`],
    ttl_days: null,
    body,
  };
}

function questionIds(candidates: Memory[]): string[] {
  return generateInterviewQuestions(candidates).map((q) => q.id);
}

describe('generateInterviewQuestions', () => {
  it('asks for map, decisions and conventions when everything is missing', () => {
    expect(questionIds([])).toEqual([
      'missing-map',
      'missing-decisions',
      'missing-conventions',
      'topic-testing',
      'topic-build',
      'topic-style',
    ]);
  });

  it('claude-md-only: asks for map, decision and build workflow', () => {
    const { candidates } = importRepo(join(REPOS_DIR, 'claude-md-only'));
    expect(questionIds(candidates)).toEqual([
      'missing-map',
      'missing-decisions',
      'topic-build',
    ]);
  });

  it('cursor-heavy: asks for a decision and style rules', () => {
    const { candidates } = importRepo(join(REPOS_DIR, 'cursor-heavy'));
    expect(questionIds(candidates)).toEqual([
      'missing-decisions',
      'topic-style',
    ]);
  });

  it('adr-rich: only the map is missing', () => {
    const { candidates } = importRepo(join(REPOS_DIR, 'adr-rich'));
    expect(questionIds(candidates)).toEqual(['missing-map']);
  });

  it('detects conflicting conventions across different sources', () => {
    const candidates = [
      convention('Testing rules', 'CLAUDE.md', 'Run tests with pnpm test.'),
      convention(
        'Testing',
        '.cursor/rules/testing.mdc',
        'Run tests with npm test in CI pipeline, lint and format first.',
      ),
    ];
    const questions = generateInterviewQuestions(candidates);
    const conflict = questions.find((q) => q.id === 'conflict-1');
    expect(conflict).toBeDefined();
    expect(conflict?.prompt).toContain('CLAUDE.md');
    expect(conflict?.prompt).toContain('.cursor/rules/testing.mdc');
    expect(conflict?.memoryClass).toBe('convention');
    // Same-source pairs (e.g. split parts) never count as conflicts.
    const samePair = [
      convention('Testing rules (part 1 of 2)', 'CLAUDE.md'),
      convention('Testing rules (part 2 of 2)', 'CLAUDE.md'),
    ];
    expect(
      questionIds(samePair).filter((id) => id.startsWith('conflict')),
    ).toEqual([]);
  });

  it('never exceeds the 10-question cap', () => {
    const scenarios: Memory[][] = [
      [],
      [
        convention('Testing rules', 'a.md'),
        convention('Testing style', 'b.md'),
        convention('Testing format', 'c.md'),
        convention('Testing lint', 'd.md'),
      ],
    ];
    for (const candidates of scenarios) {
      expect(generateInterviewQuestions(candidates).length).toBeLessThanOrEqual(
        MAX_INTERVIEW_QUESTIONS,
      );
    }
  });
});

async function interviewWithInput(
  questions: InterviewQuestion[],
  inputText: string,
): Promise<{
  answers: Awaited<ReturnType<typeof runInterview>>;
  output: string;
}> {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputText = '';
  output.on('data', (chunk: Buffer) => {
    outputText += chunk.toString();
  });
  input.end(inputText);
  const answers = await runInterview(questions, { input, output });
  return { answers, output: outputText };
}

const QUESTIONS: InterviewQuestion[] = [
  {
    id: 'missing-map',
    prompt: 'List the services.',
    memoryClass: 'map',
    memoryTitle: 'Service map',
  },
  {
    id: 'topic-testing',
    prompt: 'How are tests run?',
    memoryClass: 'convention',
    memoryTitle: 'Testing workflow',
  },
  {
    id: 'topic-style',
    prompt: 'Which lint rules matter?',
    memoryClass: 'convention',
    memoryTitle: 'Code style rules',
  },
];

describe('runInterview', () => {
  it('collects non-empty answers and skips empty ones', async () => {
    const { answers, output } = await interviewWithInput(
      QUESTIONS,
      'api: checkout; worker: payments\n\nprettier + eslint strict\n',
    );
    expect(answers.map((a) => a.question.id)).toEqual([
      'missing-map',
      'topic-style',
    ]);
    expect(output).toContain('[1/3] List the services.');
    expect(output).toContain('press Enter to skip any');
    expect(output).toContain('2 answered, 1 skipped.');
  });

  it('treats end of input as skipping the remaining questions', async () => {
    const { answers, output } = await interviewWithInput(
      QUESTIONS,
      'only one answer\n',
    );
    expect(answers).toHaveLength(1);
    expect(output).toContain('1 answered, 2 skipped.');
  });

  it('asks nothing when there are no questions', async () => {
    const { answers, output } = await interviewWithInput([], '');
    expect(answers).toEqual([]);
    expect(output).toBe('');
  });
});

describe('answersToMemories', () => {
  const FIXED_NOW = { now: () => new Date('2026-07-03T10:00:00.000Z') };

  it('turns answers into lint-clean candidates with interview provenance', () => {
    const memories = answersToMemories(
      [
        {
          question: QUESTIONS[0] as InterviewQuestion,
          text: 'api owns checkout; the payments worker reconciles Stripe.',
        },
      ],
      FIXED_NOW,
    );
    expect(memories).toHaveLength(1);
    const memory = memories[0] as Memory;
    expect(memory.class).toBe('map');
    expect(memory.title).toBe('Service map');
    expect(memory.created).toBe('2026-07-03');
    expect(memory.tags).toEqual(['interview', 'source:interview#missing-map']);
    expect(
      lintMemoryText(memoryPath(memory), serializeMemoryFile(memory)),
    ).toEqual([]);
  });

  it('splits oversized answers like any other unit', () => {
    const memories = answersToMemories(
      [
        {
          question: QUESTIONS[1] as InterviewQuestion,
          text: 'word '.repeat(450).trim(),
        },
      ],
      FIXED_NOW,
    );
    expect(memories).toHaveLength(2);
    expect(memories.map((m) => m.title)).toEqual([
      'Testing workflow (part 1 of 2)',
      'Testing workflow (part 2 of 2)',
    ]);
  });
});
