import { describe, it, expect } from 'vitest';
import { VENUE_CANONICAL_MAP, canonicalizeVenue, venueKey } from './canonical-venue';

describe('canonicalizeVenue', () => {
  // Carres: the engine carries no venue aliases. Houzs folded "PJ Showroom" and its
  // spellings into "2990s PJ"; Carres's own showroom is named "PJ Showroom" and must
  // keep that name, so every spelling now comes back trimmed and otherwise unchanged.
  it('Carres: has no alias rows at all', () => {
    expect(VENUE_CANONICAL_MAP).toEqual({});
  });

  it('Carres: keeps "PJ Showroom" and never produces a 2990 name', () => {
    for (const raw of ['PJ Showroom', 'pj showroom', 'PJ-SHOWROOM', 'pjshowroom', '2990 PJ']) {
      expect(canonicalizeVenue(raw)).toBe(raw);
    }
  });

  it('is idempotent', () => {
    expect(canonicalizeVenue(canonicalizeVenue('PJ Showroom'))).toBe('PJ Showroom');
  });

  it('trims surrounding whitespace; the lookup key still collapses inner whitespace', () => {
    expect(canonicalizeVenue('  PJ Showroom  ')).toBe('PJ Showroom');
    expect(venueKey('  PJ   Showroom ')).toBe('pj showroom');
  });

  it('leaves an unknown venue unchanged (trimmed)', () => {
    expect(canonicalizeVenue('KLCC Hall 3')).toBe('KLCC Hall 3');
    expect(canonicalizeVenue('  Sunway Pyramid ')).toBe('Sunway Pyramid');
  });

  it('treats blank / null / undefined as null (blanks stay blank)', () => {
    expect(canonicalizeVenue('')).toBeNull();
    expect(canonicalizeVenue('   ')).toBeNull();
    expect(canonicalizeVenue(null)).toBeNull();
    expect(canonicalizeVenue(undefined)).toBeNull();
  });
});
