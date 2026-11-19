// Small browser helpers: redirect safety, image sizing, recording format, invite text, waveform.
import { describe, expect, it } from 'vitest';
import { waveform } from '@/components/chat/VoicePlayer';
import { fitWithin, pickAudioMime } from '@/lib/media';
import { safeNext } from '@/lib/nav';
import { inviteText, inviteUrl } from '@/lib/share';

describe('safeNext', () => {
  it('allows same-site paths only', () => {
    expect(safeNext('/i/K7XQ2MPA')).toBe('/i/K7XQ2MPA');
    expect(safeNext('/crews/cABC')).toBe('/crews/cABC');
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', null, '']) expect(safeNext(bad)).toBe('/crews');
  });
});

describe('fitWithin', () => {
  it('scales the longest edge down to 1600 px and keeps the ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 2400)).toEqual({ width: 720, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('pickAudioMime', () => {
  it('prefers Opus/WebM, falls back to AAC/MP4 (Safari), null when nothing works', () => {
    expect(pickAudioMime(t => t === 'audio/webm;codecs=opus' || t === 'audio/mp4')).toBe('audio/webm;codecs=opus');
    expect(pickAudioMime(t => t.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickAudioMime(() => false)).toBeNull();
  });
});

describe('invite sharing', () => {
  it('builds a WhatsApp-ready message with the link inside the text', () => {
    const url = inviteUrl('https://crewarcade.app/', 'K7XQ2MPA');
    // Invite links carry the referrer (signups by referrer on /admin).
    expect(url).toBe('https://crewarcade.app/i/K7XQ2MPA?ref=invite');
    expect(inviteText('Friday crew', url)).toMatch(/Friday crew.*https:\/\/crewarcade\.app\/i\/K7XQ2MPA\?ref=invite$/);
  });
});

describe('voice waveform', () => {
  it('is deterministic per message and within (0, 1]', () => {
    expect(waveform('M1')).toEqual(waveform('M1'));
    expect(waveform('M1')).not.toEqual(waveform('M2'));
    expect(waveform('M1').every(v => v > 0 && v <= 1)).toBe(true);
  });
});
