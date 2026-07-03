import { CORE_VERSION } from '@teambrain/core';

export function cliVersion(): string {
  return CORE_VERSION;
}

export { runLintCommand } from './lint-command.js';
export type { LintCommandResult } from './lint-command.js';
export { scanRepo } from './init/scan.js';
export type { ScannedSource, SourceKind } from './init/scan.js';
export {
  importRepo,
  importSources,
  candidatesFromSpec,
} from './init/convert.js';
export type {
  ImportResult,
  ImportOptions,
  CandidateSpec,
} from './init/convert.js';
export {
  MAX_INTERVIEW_QUESTIONS,
  generateInterviewQuestions,
  runInterview,
  answersToMemories,
} from './init/interview.js';
export type {
  InterviewQuestion,
  InterviewAnswer,
  InterviewIo,
} from './init/interview.js';
