// M5.1 path deny-filter. Events referencing a path that matches a .gitignore
// entry or a brain.yaml deny-glob are dropped entirely (never redacted and
// kept). A small gitignore-flavored matcher — no third-party glob dep
// (principle 6). Supported: `*`, `**`, `?`, leading `/` (anchored), trailing
// `/` (dir prefix), `!` negation, `#` comments. Good enough for V1; exotic
// gitignore corner cases are noted in the DEVLOG.

function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith('/');
  const body = anchored ? pattern.slice(1) : pattern;
  let re = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (char === '*') {
      if (body[i + 1] === '*') {
        // `**` matches across path separators (optionally trailing `/`).
        re += '.*';
        i++;
        if (body[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (char === '?') {
      re += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      re += `\\${char}`;
    } else {
      re += char;
    }
  }
  // A trailing `/` (dir) matches the dir and everything under it.
  if (body.endsWith('/')) re += '.*';
  // Unanchored patterns match at any path segment boundary.
  const prefix = anchored ? '^' : '(^|/)';
  return new RegExp(`${prefix}${re}$`);
}

export interface DenyMatcher {
  denies(path: string): boolean;
}

/** Normalizes a path to forward slashes with no leading `./` or `/`. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Builds a matcher from raw glob/gitignore lines. Negations (`!pattern`)
 * re-include an otherwise-denied path. Blank lines and `#` comments are
 * ignored. `.gitignore` text can be split on newlines and passed straight in.
 */
export function buildDenyMatcher(patterns: string[]): DenyMatcher {
  const rules: Array<{ regex: RegExp; negated: boolean }> = [];
  for (const raw of patterns) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const body = negated ? line.slice(1) : line;
    rules.push({ regex: globToRegExp(body), negated });
  }
  return {
    denies(path: string): boolean {
      const normalized = normalizePath(path);
      let denied = false;
      for (const rule of rules) {
        if (rule.regex.test(normalized)) denied = !rule.negated;
      }
      return denied;
    },
  };
}
