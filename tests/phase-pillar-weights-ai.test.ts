import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/ai';

/**
 * Phase 4: AI consumption of pillar weights.
 * The generation system prompt must surface per-pillar importance and lead with
 * the creator's highest-weighted topics, so the model emphasizes them.
 */
describe('Phase: Pillar Weights - AI prompt', () => {
  it('renders pillars ordered by weight with importance annotations', () => {
    const prompt = buildSystemPrompt({
      display_name: 'Rudheer',
      content_pillars: [
        { name: 'Cars', description: 'car content', weight: 30 },
        { name: 'Artificial Intelligence', description: 'AI products', weight: 85 },
        { name: 'ASU', weight: 55 },
      ],
    });

    expect(prompt).toContain('CONTENT PILLARS');
    expect(prompt).toContain('Artificial Intelligence [importance 85/100]: AI products');
    expect(prompt).toContain('Cars [importance 30/100]: car content');

    // Highest-weight pillar must appear before lower-weight ones.
    const aiPos = prompt.indexOf('Artificial Intelligence [importance');
    const asuPos = prompt.indexOf('ASU [importance');
    const carsPos = prompt.indexOf('Cars [importance');
    expect(aiPos).toBeGreaterThanOrEqual(0);
    expect(aiPos).toBeLessThan(asuPos);
    expect(asuPos).toBeLessThan(carsPos);
  });

  it('omits the importance annotation when a pillar has no weight', () => {
    const prompt = buildSystemPrompt({
      display_name: 'Rudheer',
      content_pillars: [{ name: 'Founder', description: 'building in public' }],
    });
    expect(prompt).toContain('- Founder: building in public');
    // No per-pillar importance annotation when weight is absent.
    expect(prompt).not.toContain('[importance');
  });
});
