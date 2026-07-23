import { afterEach, describe, expect, it } from 'vitest';
import { ChatMessageSchema } from '@/lib/chats-schema';
import { getWriteModelCatalog, resolveWriteModel } from '@/lib/write-models';
import { buildThinkDiscussionContext } from '@/lib/think-discussion-context';

const originalCatalog = process.env.WRITE_MODEL_CATALOG_JSON;
const originalKey = process.env.TEST_WRITE_GPT_KEY;

afterEach(() => {
  if (originalCatalog === undefined) delete process.env.WRITE_MODEL_CATALOG_JSON;
  else process.env.WRITE_MODEL_CATALOG_JSON = originalCatalog;
  if (originalKey === undefined) delete process.env.TEST_WRITE_GPT_KEY;
  else process.env.TEST_WRITE_GPT_KEY = originalKey;
});

describe('Write model catalog', () => {
  it('gracefully exposes only the default when no catalog is configured', () => {
    delete process.env.WRITE_MODEL_CATALOG_JSON;
    expect(getWriteModelCatalog().map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'default', label: 'Default' },
    ]);
  });

  it('admits configured models without exposing unavailable entries', () => {
    process.env.TEST_WRITE_GPT_KEY = 'secret';
    process.env.WRITE_MODEL_CATALOG_JSON = JSON.stringify([
      { id: 'gpt', label: 'GPT', baseUrl: 'https://example.test/v1/', apiKeyEnv: 'TEST_WRITE_GPT_KEY', model: 'gpt-test' },
      { id: 'claude', label: 'Claude', baseUrl: 'https://example.test/v1', apiKeyEnv: 'MISSING_KEY', model: 'claude-test' },
    ]);
    const catalog = getWriteModelCatalog();
    expect(catalog.map((item) => item.id)).toEqual(['default', 'gpt']);
    expect(resolveWriteModel('gpt')?.model).toBe('gpt-test');
    expect(resolveWriteModel('claude')).toBeNull();
  });
});

describe('Write chat message kinds and score insights', () => {
  it('persists discussion messages separately from drafts', () => {
    expect(ChatMessageSchema.parse({ id: 'a', role: 'assistant', content: 'Consider an image.', kind: 'discussion' }).kind).toBe('discussion');
  });

  it('persists the detailed evaluation used by actionable scoring', () => {
    const message = ChatMessageSchema.parse({
      id: 'a', role: 'assistant', content: 'Draft', kind: 'draft',
      voiceMetrics: {
        ai_score: 20,
        voice_match_score: 80,
        evaluation: {
          persona_fidelity: 8, uniqueness: 6, specificity: 7, so_what: 9,
          pain_resonance: 6, ai_slop: 2, revision_notes: 'Add one concrete example.', pass: false,
        },
      },
    });
    expect(message.voiceMetrics?.evaluation?.revision_notes).toBe('Add one concrete example.');
  });

  it('trims Think history and removes blank messages before API validation', () => {
    expect(buildThinkDiscussionContext([
      { role: 'user', content: '  Should I add an image?  ' },
      { role: 'assistant', content: '   ' },
    ], '')).toEqual([
      { role: 'user', content: 'Should I add an image?' },
    ]);
  });

  it('includes uploaded image and file context in Think discussions', () => {
    const context = buildThinkDiscussionContext(
      [{ role: 'user', content: 'Would this visual help?' }],
      '\n\nATTACHED FILE CONTEXT:\n[research-chart.png]\nA bar chart showing retention rising from 40% to 70%.',
    );

    expect(context.at(-1)).toEqual({
      role: 'user',
      content: 'ATTACHED FILE CONTEXT:\n[research-chart.png]\nA bar chart showing retention rising from 40% to 70%.',
    });
  });
});
