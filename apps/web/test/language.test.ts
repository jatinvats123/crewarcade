import { LANGUAGE_CODES } from '@crewarcade/shared';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_ENGLISH, detectLanguage } from '@/lib/language';

describe('detectLanguage', () => {
  it('takes the first supported language from the browser list', () => {
    expect(detectLanguage(['hi-IN', 'en-US'])).toBe('hi');
    expect(detectLanguage(['fr-FR', 'ta', 'en'])).toBe('ta');
    expect(detectLanguage(['BN_in'])).toBe('bn');
  });
  it('falls back to English', () => {
    expect(detectLanguage(['fr-FR', 'de'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage([''])).toBe('en');
  });
  it('has an English name for every language', () => {
    for (const code of LANGUAGE_CODES) expect(LANGUAGE_ENGLISH[code]).toBeTruthy();
  });
});
