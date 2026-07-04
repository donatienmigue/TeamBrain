import { exitCodeForError, type ErrorExitCode } from '@teambrain/core';
import { importRepo, type ImportOptions } from './convert.js';
import {
  answersToMemories,
  generateInterviewQuestions,
  runInterview,
  type InterviewIo,
} from './interview.js';
import {
  INIT_BRANCH,
  validateInitTarget,
  writeInitBranch,
  type InitBranchResult,
} from './branch.js';

export interface InitCommandOptions extends ImportOptions {
  /** Run the gap interview (default false; tb wires this to TTY + !--yes). */
  interview?: boolean;
  /** Streams for the interview; required when interview is true. */
  io?: InterviewIo;
}

export interface InitCommandResult {
  exitCode: 0 | ErrorExitCode;
  output: string;
}

function nextSteps(
  result: InitBranchResult,
  memoryCount: number,
  sourceCount: number,
): string {
  return (
    `\nImported ${memoryCount} memories from ${sourceCount} source(s) — ` +
    `${result.fileCount} files on branch ${INIT_BRANCH} ` +
    `(commit ${result.commit.slice(0, 7)}, branched from ${result.base}).\n` +
    '\nNext steps:\n' +
    `  1. Review:  git switch ${INIT_BRANCH}   (or: git diff ${result.base}...${INIT_BRANCH})\n` +
    `  2. Push:    git push -u origin ${INIT_BRANCH}\n` +
    '  3. Open a pull request and merge it to share the brain with the team.\n' +
    '\nYour current branch and working tree were not touched.\n'
  );
}

export async function runInitCommand(
  repoDir: string,
  options: InitCommandOptions = {},
): Promise<InitCommandResult> {
  try {
    // Validate the target before importing or interviewing: a non-git
    // directory should fail as such, not as "nothing to import". A
    // subdirectory target resolves to the repo root so the scan scope
    // matches where the brain is written.
    const repoRoot = validateInitTarget(repoDir);
    const { sources, candidates } = importRepo(repoRoot, options);
    let memories = candidates;

    if (options.interview === true && options.io !== undefined) {
      const questions = generateInterviewQuestions(candidates);
      const answers = await runInterview(questions, options.io);
      memories = [...candidates, ...answersToMemories(answers, options)];
    }

    if (memories.length === 0) {
      return {
        exitCode: 1,
        output:
          'tb init: nothing to import — no CLAUDE.md, AGENTS.md, cursor ' +
          'rules, ADRs or README architecture sections found, and no ' +
          'interview answers given.\n',
      };
    }

    const result = writeInitBranch(repoRoot, memories);
    return {
      exitCode: 0,
      output: nextSteps(result, memories.length, sources.length),
    };
  } catch (err) {
    return {
      exitCode: exitCodeForError(err),
      output: `tb init: ${(err as Error).message}\n`,
    };
  }
}
