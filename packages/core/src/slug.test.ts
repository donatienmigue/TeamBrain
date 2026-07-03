import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('kebab-cases plain titles', () => {
    expect(slugify('S3 client needs custom retry wrapper')).toBe(
      's3-client-needs-custom-retry-wrapper',
    );
  });

  it('folds diacritics and strips punctuation', () => {
    expect(slugify('Módulo de facturación: URLs y colas')).toBe(
      'modulo-de-facturacion-urls-y-colas',
    );
    expect(slugify('Quote "everything": colons & #hashes!')).toBe(
      'quote-everything-colons-hashes',
    );
  });

  it('collapses runs of separators and trims edges', () => {
    expect(slugify('  --Hello,   world!--  ')).toBe('hello-world');
  });

  it('caps length at 48 without a trailing hyphen', () => {
    const slug = slugify(
      'Adopt reciprocal-rank fusion for hybrid retrieval strategies',
    );
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "untitled" when nothing survives', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('¿¡…!?')).toBe('untitled');
  });
});
