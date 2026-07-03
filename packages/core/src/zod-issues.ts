import { z } from 'zod';

/** Renders zod issues as `path: message` pairs for error messages. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
