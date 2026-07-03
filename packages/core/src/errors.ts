// M1.3 typed error hierarchy. Every TeamBrainError maps to a C6 CLI exit
// code: 1 user error, 2 environment error, 3 lint/validation failure.
// (0 is success and never an error.)

export type ErrorExitCode = 1 | 2 | 3;

export abstract class TeamBrainError extends Error {
  abstract readonly exitCode: ErrorExitCode;
}

/** Bad input from the human: arguments, paths, malformed requests. */
export class UserError extends TeamBrainError {
  override readonly name: string = 'UserError';
  readonly exitCode = 1 as const;
}

/** The surroundings failed: filesystem, daemon, git, permissions. */
export class EnvironmentError extends TeamBrainError {
  override readonly name: string = 'EnvironmentError';
  readonly exitCode = 2 as const;
}

/** Content failed schema or lint validation. */
export class ValidationError extends TeamBrainError {
  override readonly name: string = 'ValidationError';
  readonly exitCode = 3 as const;
}

/**
 * Maps any thrown value to a C6 exit code. Errors that were not raised
 * through the hierarchy are treated as environment errors: if the code
 * meant "the user did something wrong" it would have said so.
 */
export function exitCodeForError(err: unknown): ErrorExitCode {
  return err instanceof TeamBrainError ? err.exitCode : 2;
}
