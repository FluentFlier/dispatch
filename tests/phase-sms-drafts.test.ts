/**
 * Phase: SMS Draft Flow (Twilio)
 *
 * Covers the pure, security-sensitive logic: signed magic-link tokens and
 * inbound-message parsing / TwiML. Outbound send + webhook DB effects need live
 * Twilio + storage and are not unit-tested here.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Deterministic secret so token signing works without real env.
beforeAll(() => {
  process.env.DRAFT_TOKEN_SECRET = 'test-secret-key-for-draft-tokens';
});

import {
  signDraftToken,
  verifyDraftToken,
  DRAFT_TOKEN_TTL_SECONDS,
} from '@/lib/sms/draft-token';
import { parseInboundMessage, buildTwimlReply, validateInboundSignature } from '@/lib/sms/twilio';

describe('Phase: SMS Draft Flow', () => {
  describe('draft magic-link tokens', () => {
    const now = 1_000_000;
    const payload = { postId: '11111111-1111-1111-1111-111111111111', userId: 'user_42' };

    it('round-trips a valid token', () => {
      const token = signDraftToken(payload, DRAFT_TOKEN_TTL_SECONDS, now);
      const out = verifyDraftToken(token, now + 10);
      expect(out?.postId).toBe(payload.postId);
      expect(out?.userId).toBe(payload.userId);
      expect(out?.exp).toBe(now + DRAFT_TOKEN_TTL_SECONDS);
    });

    it('rejects an expired token', () => {
      const token = signDraftToken(payload, 60, now);
      expect(verifyDraftToken(token, now + 61)).toBeNull();
    });

    it('rejects a tampered payload', () => {
      const token = signDraftToken(payload, DRAFT_TOKEN_TTL_SECONDS, now);
      const [, sig] = token.split('.');
      const forged = Buffer.from(
        JSON.stringify({ postId: 'evil', userId: 'attacker', exp: now + 999 }),
      ).toString('base64url');
      expect(verifyDraftToken(`${forged}.${sig}`, now)).toBeNull();
    });

    it('rejects a bad signature', () => {
      const token = signDraftToken(payload, DRAFT_TOKEN_TTL_SECONDS, now);
      const [body] = token.split('.');
      expect(verifyDraftToken(`${body}.deadbeef`, now)).toBeNull();
    });

    it('rejects malformed input', () => {
      expect(verifyDraftToken('', now)).toBeNull();
      expect(verifyDraftToken('nodot', now)).toBeNull();
    });
  });

  describe('parseInboundMessage', () => {
    it('extracts text + image media from Twilio params', () => {
      const msg = parseInboundMessage({
        From: '+15551234567',
        To: '+15559999999',
        Body: 'add this photo',
        MessageSid: 'SM123',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/abc',
        MediaContentType0: 'image/jpeg',
      });
      expect(msg.from).toBe('+15551234567');
      expect(msg.body).toBe('add this photo');
      expect(msg.media).toEqual([{ url: 'https://api.twilio.com/media/abc', contentType: 'image/jpeg' }]);
    });

    it('handles no media', () => {
      const msg = parseInboundMessage({ From: '+1', To: '+2', Body: 'hi', NumMedia: '0' });
      expect(msg.media).toHaveLength(0);
    });
  });

  describe('buildTwimlReply', () => {
    it('wraps a message in TwiML', () => {
      const xml = buildTwimlReply('Draft updated.');
      expect(xml).toContain('<Response>');
      expect(xml).toContain('<Message>Draft updated.</Message>');
    });

    it('returns an empty Response for no reply', () => {
      const xml = buildTwimlReply('');
      expect(xml).toContain('<Response');
      expect(xml).not.toContain('<Message>');
    });
  });

  describe('validateInboundSignature', () => {
    it('fails closed when the signature header is missing', () => {
      expect(validateInboundSignature(null, 'https://x/y', {})).toBe(false);
    });
  });
});
