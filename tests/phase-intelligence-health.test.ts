/**
 * Phase: Intelligence health tool (voice + hooks + social listening)
 */
import { describe, it, expect } from 'vitest';
import {
  checkVoiceStack,
  checkHooksStack,
  checkSocialListeningStack,
  buildIntelligenceHealthReport,
} from '@/lib/intelligence/health';

describe('Phase: Intelligence health', () => {
  it('should report hooks ok when bootstrap dataset loads', () => {
    const hooks = checkHooksStack();
    expect(hooks.status).not.toBe('missing');
    expect(hooks.details?.hook_count).toBeGreaterThan(1000);
  });

  it('should build a full report with all subsystems', async () => {
    const report = await buildIntelligenceHealthReport();
    expect(report.voice).toBeDefined();
    expect(report.hooks).toBeDefined();
    expect(report.socialListening).toBeDefined();
    expect(report.database).toBeDefined();
    expect(report.loop).toBeDefined();
    expect(report.loop.flywheelStatus).toBeDefined();
    expect(Array.isArray(report.actions)).toBe(true);
  });

  it('should flag missing LLM when env unset', () => {
    const prevUrl = process.env.LLM_BASE_URL;
    const prevKey = process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    try {
      const voice = checkVoiceStack();
      expect(voice.status).toBe('missing');
    } finally {
      if (prevUrl) process.env.LLM_BASE_URL = prevUrl;
      if (prevKey) process.env.LLM_API_KEY = prevKey;
    }
  });

  it('should describe social listening ingest paths', () => {
    const social = checkSocialListeningStack();
    expect(['ok', 'degraded', 'missing']).toContain(social.status);
    expect(social.details?.ingest_mode ?? social.message).toBeTruthy();
  });
});
