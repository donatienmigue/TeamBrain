# TeamBrain redaction corpus

A public, adversarial test corpus for the redaction engine
(`packages/redact`). It is a **release gate**: CI fails on any regression, so
no build ships that leaks a secret or over-redacts a benign token.

## Format

`corpus.jsonl` — one JSON object per line:

| field          | when       | meaning                                                        |
| -------------- | ---------- | -------------------------------------------------------------- |
| `id`           | always     | stable case identifier                                         |
| `kind`         | always     | `positive` (must redact) or `negative` (must pass through)     |
| `input`        | always     | the raw string fed to `redactString(input, 'strict')`          |
| `detector`     | positives  | the detector under test (informational)                        |
| `expect_types` | positives  | replacement type labels that must appear (e.g. `aws_access_key`) |
| `secret`       | positives  | substring that must be **absent** from the redacted output     |
| `note`         | negatives  | why this benign input must not be redacted                     |

## Assertions (see `../src/corpus.test.ts`)

- **Positive:** every `expect_types` label appears in the replacements and the
  `secret` substring is gone from the output.
- **Negative:** the output is byte-identical to the input and no replacement
  fired — the class of tricky non-secrets (git SHAs, UUIDs, file paths,
  semver, hex colors, timestamps, code identifiers, prose) must never redact.

## Contributing

Add cases for any new detector or any real-world false positive/negative you
hit. Keep the split honest: a new secret pattern needs both positives (it
fires) and nearby negatives (it doesn't over-fire).
