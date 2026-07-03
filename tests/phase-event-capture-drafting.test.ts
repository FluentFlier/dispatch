import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LLM so generateEventQuestions is deterministic + we can inspect the prompt.
const generateContentMock = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock('@/lib/ai', () => ({
  generateContent: (...args: unknown[]) => generateContentMock(...args),
}));

import {
  buildQuestionsAndAnswers,
  resolvePostPillar,
  sanitizeAnswer,
  buildWriteUrl,
} from '@/lib/event-capture/draft-context';
import { generateEventQuestions } from '@/lib/event-capture/questions';
import { isPublicEvent } from '@/lib/event-capture/filter';
import type { EventType } from '@/lib/event-capture/filter';

describe('Event capture: answers saved', () => {
  it('trims, strips control chars, caps at 500', () => {
    expect(sanitizeAnswer('  hello  ')).toBe('hello');
    expect(sanitizeAnswer('a\x00b\x07c')).toBe('abc');
    expect(sanitizeAnswer('x'.repeat(600)).length).toBe(500);
  });
  it('keeps readable whitespace (tab/newline)', () => {
    expect(sanitizeAnswer('line1\nline2\tend')).toBe('line1\nline2\tend');
  });
});

describe('Event capture: answers imported into the written post', () => {
  const questions = ['What stood out?', 'Who did you meet?', 'One takeaway?'];

  it('pairs each answer with its question by index (the UI/process contract)', () => {
    const answers = { '0': 'The keynote', '1': 'Two founders', '2': 'Ship faster' };
    const out = buildQuestionsAndAnswers(questions, answers);
    expect(out).toContain('Q: What stood out?\nA: The keynote');
    expect(out).toContain('Q: Who did you meet?\nA: Two founders');
    expect(out).toContain('Q: One takeaway?\nA: Ship faster');
  });

  it('drops questions the user did not answer', () => {
    const out = buildQuestionsAndAnswers(questions, { '1': 'Two founders' });
    expect(out).toBe('Q: Who did you meet?\nA: Two founders');
  });

  it('ignores blank/whitespace-only answers', () => {
    expect(buildQuestionsAndAnswers(questions, { '0': '   ' })).toBe('');
  });

  it('returns empty string when there are no answers', () => {
    expect(buildQuestionsAndAnswers(questions, {})).toBe('');
    expect(buildQuestionsAndAnswers(questions, null)).toBe('');
  });

  it('would produce NOTHING if answers were keyed by text instead of index (guards the contract)', () => {
    const byText = { 'What stood out?': 'The keynote' };
    expect(buildQuestionsAndAnswers(questions, byText)).toBe('');
  });
});

describe('Event capture: generate -> Write hand-off carries the draft', () => {
  it('opens /generate prefilled with the post text (result) and event title (topic)', () => {
    const url = buildWriteUrl('My generated LinkedIn post', 'YC W25 Demo Day');
    expect(url.startsWith('/generate?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('result')).toBe('My generated LinkedIn post');
    expect(params.get('topic')).toBe('YC W25 Demo Day');
  });

  it('encodes special characters safely (no broken URL)', () => {
    const url = buildWriteUrl('Line1\nLine2 & more = ok?', 'A/B: Event #1');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('result')).toBe('Line1\nLine2 & more = ok?');
    expect(params.get('topic')).toBe('A/B: Event #1');
  });
});

describe('Event capture: post pillar (NOT NULL guard)', () => {
  it('uses the creator first content pillar', () => {
    expect(resolvePostPillar({ content_pillars: [{ name: 'Founders' }, { name: 'AI' }] })).toBe('Founders');
  });
  it('falls back to general when no pillars or profile', () => {
    expect(resolvePostPillar({ content_pillars: [] })).toBe('general');
    expect(resolvePostPillar(null)).toBe('general');
  });
});

describe('Event capture: questions relevant to the calendar event', () => {
  beforeEach(() => generateContentMock.mockReset());

  const baseCtx = {
    title: 'YC W25 Demo Day',
    startDate: '2026-03-18',
    location: 'San Francisco',
    eventType: 'demo_day' as EventType,
    isPublicEvent: true,
  };

  it('feeds the actual event title + type into the LLM prompt (relevance by construction)', async () => {
    generateContentMock.mockResolvedValue('Q1\nQ2\nQ3\nQ4\nQ5');
    await generateEventQuestions(baseCtx);
    const userPrompt = String(generateContentMock.mock.calls[0][0]);
    expect(userPrompt).toContain('YC W25 Demo Day');
    expect(userPrompt).toContain('demo_day');
    expect(userPrompt).toContain('San Francisco');
  });

  it('anchors questions to the creator content pillars when provided', async () => {
    generateContentMock.mockResolvedValue('a\nb\nc\nd\ne');
    await generateEventQuestions({ ...baseCtx, contentPillars: [{ name: 'Fundraising' }] });
    expect(String(generateContentMock.mock.calls[0][0])).toContain('Fundraising');
  });

  it('includes research detail in the prompt when available (precise questions)', async () => {
    generateContentMock.mockResolvedValue('a\nb\nc\nd\ne');
    await generateEventQuestions({ ...baseCtx, researchRawText: 'Speaker: Jane Doe announced X.' });
    expect(String(generateContentMock.mock.calls[0][0])).toContain('Jane Doe');
  });

  it('returns exactly 5 questions and strips numbering', async () => {
    generateContentMock.mockResolvedValue('1. First?\n2) Second?\n3. Third?\n4. Fourth?\n5. Fifth?');
    const qs = await generateEventQuestions(baseCtx);
    expect(qs).toHaveLength(5);
    expect(qs[0]).toBe('First?');
    expect(qs[1]).toBe('Second?');
  });

  it('pads with fallbacks when the LLM returns fewer than 5', async () => {
    generateContentMock.mockResolvedValue('Only one question?');
    const qs = await generateEventQuestions(baseCtx);
    expect(qs).toHaveLength(5);
    expect(qs[0]).toBe('Only one question?');
    expect(qs[4].length).toBeGreaterThan(0); // fallback filled
  });
});

describe('Event capture: research gating drives question quality', () => {
  it('runs web research only for public event types', () => {
    expect(isPublicEvent('conference')).toBe(true);
    expect(isPublicEvent('workshop')).toBe(true);
    expect(isPublicEvent('demo_day')).toBe(true);
    // Private/academic sessions have no web footprint -> generic questions by design.
    expect(isPublicEvent('other')).toBe(false);
    expect(isPublicEvent('internal')).toBe(false);
    expect(isPublicEvent('customer_call')).toBe(false);
  });
});
