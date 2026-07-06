// M5.1 secret detectors: a vendored, gitleaks-compatible subset. Each rule
// is (type, regex) where `type` becomes the «REDACTED:type» label. Kept
// deliberately specific — the entropy scanner (entropy.ts) is the catch-all
// for opaque high-entropy tokens these prefixes miss. Regexes are `g`-flagged
// and used with String.replace; order matters only for label precision.

export interface SecretRule {
  type: string;
  regex: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  // Private key blocks (PEM) — match the whole armored block.
  {
    type: 'private_key',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  // AWS access key id.
  { type: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  // GitHub tokens (classic + fine-grained).
  { type: 'github_token', regex: /\bgh[posru]_[0-9A-Za-z]{36}\b/g },
  { type: 'github_token', regex: /\bgithub_pat_[0-9A-Za-z_]{60,}\b/g },
  // GitLab personal access token.
  { type: 'gitlab_token', regex: /\bglpat-[0-9A-Za-z_-]{20}\b/g },
  // Slack tokens.
  { type: 'slack_token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  // Google API key.
  { type: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Stripe live secret / restricted keys.
  { type: 'stripe_key', regex: /\b[rs]k_live_[0-9A-Za-z]{24,}\b/g },
  // Anthropic key (check before the generic sk- rule).
  { type: 'anthropic_key', regex: /\bsk-ant-[0-9A-Za-z_-]{20,}\b/g },
  // OpenAI keys (sk- / sk-proj-).
  { type: 'openai_key', regex: /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/g },
  // npm automation token.
  { type: 'npm_token', regex: /\bnpm_[0-9A-Za-z]{36}\b/g },
  // JSON Web Token (three base64url segments).
  {
    type: 'jwt',
    regex: /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b/g,
  },
  // Credentialed connection strings (redact the whole URI).
  {
    type: 'connection_string',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]*:[^\s:/@]+@\S+/g,
  },
  // Assignment-style generic secret: key [:=] value (≥12 chars). Requires an
  // explicit assignment so prose mentioning "token"/"password" doesn't trip.
  {
    type: 'generic_secret',
    regex:
      /\b(?:api[_-]?key|secret|access[_-]?key|auth[_-]?token|token|password|passwd)\b\s*[:=]\s*["']?([0-9A-Za-z_\-/+=.]{12,})["']?/gi,
  },
];
