import { describe, expect, it } from 'vitest';
import {
  AVATAR_EMOJIS,
  CreateCrewBody,
  DisplayName,
  GuestSignupBody,
  MESSAGE_TYPES,
  MESSAGE_TYPE_REGISTRY,
  ProfilePatch,
  STATUS_MESSAGE_TYPES,
  dbUserIdFromNexconn,
  extractLogText,
  nexconnUserId,
  parseImageContent,
  parseTextContent,
  parseVoiceContent,
} from '../src';

describe('display names', () => {
  it('accepts 2-24 characters after trimming, in any script', () => {
    expect(DisplayName.parse('  Riya  ')).toBe('Riya');
    expect(DisplayName.parse('रिया')).toBe('रिया');
    expect(DisplayName.parse('Sam   K')).toBe('Sam K');
    expect(DisplayName.parse('x'.repeat(24))).toHaveLength(24);
  });
  it('rejects too short, too long and invisible or control characters', () => {
    for (const bad of ['a', ' a ', 'x'.repeat(25), 'Riya\u0000', '​Riya', '<script>', '']) expect(DisplayName.safeParse(bad).success).toBe(false);
  });
});

describe('signup and profile bodies', () => {
  it('needs one of the 24 emojis and 6 colours; language defaults to en', () => {
    expect(AVATAR_EMOJIS).toHaveLength(24);
    expect(GuestSignupBody.parse({ displayName: 'Riya', avatarEmoji: '🦊', avatarColor: 'pink' }).language).toBe('en');
    expect(GuestSignupBody.safeParse({ displayName: 'Riya', avatarEmoji: '💩', avatarColor: 'pink' }).success).toBe(false);
    expect(GuestSignupBody.safeParse({ displayName: 'Riya', avatarEmoji: '🦊', avatarColor: 'red' }).success).toBe(false);
    expect(GuestSignupBody.safeParse({ displayName: 'Riya', avatarEmoji: '🦊', avatarColor: 'pink', language: 'xx' }).success).toBe(false);
  });
  it('profile patch needs at least one field', () => {
    expect(ProfilePatch.safeParse({}).success).toBe(false);
    expect(ProfilePatch.parse({ language: 'hi' })).toEqual({ language: 'hi' });
  });
  it('crew names are 2-40 characters', () => {
    expect(CreateCrewBody.parse({ name: ' Friday  crew ' })).toEqual({ name: 'Friday crew', kind: 'crew' });
    expect(CreateCrewBody.safeParse({ name: 'x' }).success).toBe(false);
    expect(CreateCrewBody.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('Nexconn id mapping', () => {
  it('round-trips agents and leaves humans alone', () => {
    for (const id of ['agent-pixel', 'agent-forge', 'agent-glitch', 'u4fK9xQ2LmN8pR3tV']) expect(dbUserIdFromNexconn(nexconnUserId(id))).toBe(id);
    expect(dbUserIdFromNexconn('someone')).toBe('someone');
  });
});

describe('custom message registry', () => {
  it('uses the SDK spelling isPersisted and registers CA:Typing as a status message', () => {
    for (const r of MESSAGE_TYPE_REGISTRY) expect(Object.keys(r)).toContain('isPersisted');
    expect(MESSAGE_TYPE_REGISTRY.find(r => r.messageType === MESSAGE_TYPES.typing)).toEqual({
      messageType: 'CA:Typing',
      isPersisted: false,
      isCounted: false,
      isStatusMessage: true,
    });
    expect([...STATUS_MESSAGE_TYPES].sort()).toEqual(['CA:AgentState', 'CA:Reaction', 'CA:Typing']);
  });
});

describe('content parsing', () => {
  it('reads text from SDK objects and server wire JSON, with mentions', () => {
    expect(parseTextContent({ text: 'hi @pixel', mentionedInfo: { type: 2, userIdList: ['agentpixel'] } })).toEqual({
      text: 'hi @pixel',
      mentionedUserIds: ['agentpixel'],
      mentionAll: false,
    });
    expect(parseTextContent('{"content":"Hello","extra":""}')?.text).toBe('Hello');
    expect(parseTextContent('not json')).toBeNull();
  });
  it('extracts log text only for text messages', () => {
    expect(extractLogText('RC:TxtMsg', '{"content":"Hello"}')).toBe('Hello');
    expect(extractLogText('RC:ImgMsg', '{"imageUri":"https://x/y.jpg"}')).toBeNull();
    expect(extractLogText('RC:TxtMsg', JSON.stringify({ content: 'x'.repeat(5000) }))).toHaveLength(2000);
  });
  it('only accepts http(s)/blob media URLs', () => {
    expect(parseImageContent({ remoteUrl: 'https://cdn/x.jpg', thumbnailBase64: 'AAAA' })).toEqual({
      url: 'https://cdn/x.jpg',
      thumb: 'data:image/jpeg;base64,AAAA',
    });
    expect(parseImageContent({ remoteUrl: 'javascript:alert(1)' })).toBeNull();
    expect(parseVoiceContent({ remoteUrl: 'https://cdn/v.webm', duration: 3.6 })).toEqual({ url: 'https://cdn/v.webm', durationS: 4 });
    expect(parseVoiceContent({ remoteUrl: 'data:audio/x', duration: 1 })).toBeNull();
  });
});
