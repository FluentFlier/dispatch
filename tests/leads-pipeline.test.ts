/** CRM pipeline column derivation (phase 6). */
import { describe, it, expect } from 'vitest';
import { pipelineColumn, PIPELINE_COLUMNS } from '@/lib/leads/feed-view';

describe('pipelineColumn', () => {
  it('pre-funnel leads are excluded', () => {
    expect(pipelineColumn({ lead_status: 'new' })).toBeNull();
    expect(pipelineColumn({ lead_status: 'drafted' })).toBeNull();
  });

  it('sent leads are contacted until a reply or explicit call', () => {
    expect(pipelineColumn({ lead_status: 'sent' })).toBe('contacted');
  });

  it('replies (either direction) mean in conversation', () => {
    expect(pipelineColumn({ lead_status: 'sent', needs_reply: true })).toBe('in_conversation');
    expect(pipelineColumn({ lead_status: 'sent', nurture_stage: 'replied' })).toBe('in_conversation');
    expect(pipelineColumn({ lead_status: 'sent', nurture_stage: 'in_conversation' })).toBe('in_conversation');
  });

  it('explicit conversion calls win over derived state', () => {
    expect(pipelineColumn({ lead_status: 'sent', needs_reply: true, conversion_stage: 'meeting_booked' })).toBe('meeting_booked');
    expect(pipelineColumn({ lead_status: 'sent', conversion_stage: 'won' })).toBe('closed');
    expect(pipelineColumn({ lead_status: 'sent', conversion_stage: 'lost' })).toBe('closed');
    expect(pipelineColumn({ lead_status: 'sent', conversion_stage: 'not_now' })).toBe('closed');
  });

  it('every column key is derivable', () => {
    const keys = new Set([
      pipelineColumn({ lead_status: 'sent' }),
      pipelineColumn({ lead_status: 'sent', needs_reply: true }),
      pipelineColumn({ lead_status: 'sent', conversion_stage: 'meeting_booked' }),
      pipelineColumn({ lead_status: 'sent', conversion_stage: 'won' }),
    ]);
    for (const col of PIPELINE_COLUMNS) expect(keys.has(col.key)).toBe(true);
  });
});
