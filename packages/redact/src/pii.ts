// M5.1 PII detectors: email, phone, IP. Applied only at redaction level
// `strict` (the brain.yaml default); `standard` keeps PII while still
// scrubbing secrets and high-entropy tokens.

export interface PiiRule {
  type: string;
  regex: RegExp;
}

export const PII_RULES: PiiRule[] = [
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // IPv4 with octet range validation, so a 3-part version like 1.2.3 or a
  // 4-part semver 1.2.3.4 with an out-of-range part is not treated as an IP.
  {
    type: 'ip',
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
  // IPv6: full 8-hextet form, or any `::`-compressed form. Requiring either
  // 7 colons or a literal `::` keeps clock strings like 12:34:56 from matching.
  {
    type: 'ip',
    regex:
      /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:(?:[0-9A-Fa-f]{1,4})?/g,
  },
  // North-American / international phone numbers with separators.
  {
    type: 'phone',
    regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g,
  },
];
