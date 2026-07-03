import { createInterface } from 'node:readline';
import type { Memory, MemoryClass } from '@teambrain/core';
import { candidatesFromSpec } from './convert.js';

// M2.2 init interview: at most 10 questions generated from gaps in the
// imported candidates. Plain readline, every question skippable (empty
// answer or end of input); answers become candidate memories tagged
// `interview` so M2.3 writes them alongside the imported ones.

export const MAX_INTERVIEW_QUESTIONS = 10;
const MAX_CONFLICT_QUESTIONS = 3;

export interface InterviewQuestion {
  /** Stable id, e.g. 'missing-map', 'conflict-1', 'topic-testing'. */
  id: string;
  /** Question shown to the human. */
  prompt: string;
  /** Class of the memory a non-empty answer becomes. */
  memoryClass: MemoryClass;
  /** Title of that memory. */
  memoryTitle: string;
}

export interface InterviewAnswer {
  question: InterviewQuestion;
  /** Non-empty answer text. */
  text: string;
}

const TITLE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'for',
  'of',
  'and',
  'to',
  'in',
  'on',
]);

function titleTokens(title: string): Set<string> {
  const tokens = title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(tokens.filter((token) => !TITLE_STOPWORDS.has(token)));
}

/** Overlap coefficient: |A∩B| / min(|A|,|B|). */
function titleOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

function sourceOf(candidate: Memory): string {
  return (
    candidate.tags.find((tag) => tag.startsWith('source:'))?.slice(7) ??
    'unknown'
  );
}

/** Convention pairs from different sources whose titles overlap. */
function findConflictingConventions(
  candidates: Memory[],
): Array<[Memory, Memory]> {
  const conventions = candidates.filter((c) => c.class === 'convention');
  const conflicts: Array<[Memory, Memory]> = [];
  for (let i = 0; i < conventions.length; i++) {
    for (let j = i + 1; j < conventions.length; j++) {
      const a = conventions[i] as Memory;
      const b = conventions[j] as Memory;
      if (sourceOf(a) === sourceOf(b)) continue;
      if (titleOverlap(titleTokens(a.title), titleTokens(b.title)) >= 0.5) {
        conflicts.push([a, b]);
      }
    }
  }
  return conflicts;
}

function candidateTextMentions(candidates: Memory[], pattern: RegExp): boolean {
  return candidates.some((c) => pattern.test(c.title) || pattern.test(c.body));
}

export function generateInterviewQuestions(
  candidates: Memory[],
): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [];
  const hasClass = (memoryClass: MemoryClass): boolean =>
    candidates.some((c) => c.class === memoryClass);

  if (!hasClass('map')) {
    questions.push({
      id: 'missing-map',
      prompt:
        'No architecture map was found. List the main services or ' +
        'components and what each one owns.',
      memoryClass: 'map',
      memoryTitle: 'Service map',
    });
  }
  if (!hasClass('decision')) {
    questions.push({
      id: 'missing-decisions',
      prompt:
        'No architecture decision records were found. What is the most ' +
        'consequential technical decision this team has made, and why?',
      memoryClass: 'decision',
      memoryTitle: 'Founding technical decision',
    });
  }
  if (!hasClass('convention')) {
    questions.push({
      id: 'missing-conventions',
      prompt:
        'No coding rules were found. What conventions must every ' +
        'contributor follow?',
      memoryClass: 'convention',
      memoryTitle: 'Core team conventions',
    });
  }

  findConflictingConventions(candidates)
    .slice(0, MAX_CONFLICT_QUESTIONS)
    .forEach(([a, b], index) => {
      questions.push({
        id: `conflict-${index + 1}`,
        prompt:
          `"${a.title}" (${sourceOf(a)}) and "${b.title}" (${sourceOf(b)}) ` +
          'cover similar ground. When they disagree, which rule wins?',
        memoryClass: 'convention',
        memoryTitle: `Rule precedence: ${a.title}`,
      });
    });

  const topicGaps: Array<[string, RegExp, string, string]> = [
    [
      'topic-testing',
      /test/i,
      'How does the team run and gate tests before merging?',
      'Testing workflow',
    ],
    [
      'topic-build',
      /\b(build|ci|pipeline)\b/i,
      'How is the project built and what must pass in CI before a merge?',
      'Build and CI workflow',
    ],
    [
      'topic-style',
      /\b(lint|format|style)\b/i,
      'What code style or lint rules matter most here?',
      'Code style rules',
    ],
  ];
  for (const [id, pattern, prompt, memoryTitle] of topicGaps) {
    if (!candidateTextMentions(candidates, pattern)) {
      questions.push({
        id,
        prompt,
        memoryClass: 'convention',
        memoryTitle,
      });
    }
  }

  return questions.slice(0, MAX_INTERVIEW_QUESTIONS);
}

export interface InterviewIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/**
 * Asks each question on plain readline. Empty answers skip; end of
 * input (Ctrl+D / closed stream) skips everything remaining.
 *
 * Lines are buffered through a persistent listener: rl.question() only
 * captures the line following the call, which drops piped input that
 * arrives between questions (and rejects at EOF).
 */
export async function runInterview(
  questions: InterviewQuestion[],
  io: InterviewIo,
): Promise<InterviewAnswer[]> {
  if (questions.length === 0) return [];
  const rl = createInterface({ input: io.input, output: io.output });

  const bufferedLines: string[] = [];
  let waitingReader: ((line: string | null) => void) | null = null;
  let inputEnded = false;
  rl.on('line', (line) => {
    if (waitingReader !== null) {
      const deliver = waitingReader;
      waitingReader = null;
      deliver(line);
    } else {
      bufferedLines.push(line);
    }
  });
  rl.on('close', () => {
    inputEnded = true;
    waitingReader?.(null);
    waitingReader = null;
  });
  const nextLine = (): Promise<string | null> => {
    const buffered = bufferedLines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (inputEnded) return Promise.resolve(null);
    return new Promise((resolve) => {
      waitingReader = resolve;
    });
  };

  io.output.write(
    `\nTeamBrain interview — ${questions.length} question(s); ` +
      'press Enter to skip any.\n\n',
  );

  const answers: InterviewAnswer[] = [];
  for (const [index, question] of questions.entries()) {
    io.output.write(
      `[${index + 1}/${questions.length}] ${question.prompt}\n> `,
    );
    const reply = await nextLine();
    if (reply === null) break;
    const text = reply.trim();
    if (text.length > 0) answers.push({ question, text });
  }
  if (!inputEnded) rl.close();

  io.output.write(
    `\n${answers.length} answered, ${questions.length - answers.length} skipped.\n`,
  );
  return answers;
}

export interface AnswersToMemoriesOptions {
  now?: () => Date;
}

/** Converts non-empty answers into candidate memories. */
export function answersToMemories(
  answers: InterviewAnswer[],
  options: AnswersToMemoriesOptions = {},
): Memory[] {
  const now = options.now ?? (() => new Date());
  const created = now().toISOString().slice(0, 10);
  return answers.flatMap((answer) =>
    candidatesFromSpec(
      {
        title: answer.question.memoryTitle,
        text: answer.text,
        memoryClass: answer.question.memoryClass,
        sourceLabel: `interview#${answer.question.id}`,
        extraTags: ['interview'],
      },
      created,
    ),
  );
}
