import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { generateContent } from '@/lib/ai';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import {
  stripJsonFences,
  type ImportedVoiceProfile,
} from '@/lib/voice-import-prompt';

const MAX_INPUT = 100_000;

const ImportSchema = z.object({
  text: z.string().min(20).max(MAX_INPUT),
});

const EXTRACT_SYSTEM = `You map a user's exported memory from ChatGPT, Claude, Gemini, or similar into fields for a social content writing app.

Return ONLY a JSON object (no prose, no code fences):

{
  "display_name": string | null,
  "bio_facts": string | null,
  "voice_description": string | null,
  "voice_rules": string | null
}

Rules:
- display_name: first name or brand name if clearly stated.
- bio_facts: 2-4 sentences - role, audience, what they create content about.
- voice_description: 2-4 sentences on tone and style for social posts.
- voice_rules: line-separated DO/NEVER rules from their writing instructions; empty string if none.
- Do not invent. Omit with null if the export does not support a field.`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paste your export first (at least 20 characters).' }, { status: 400 });
  }

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const raw = await generateContent(
      `Memory export:\n---\n${parsed.data.text}\n---`,
      undefined,
      EXTRACT_SYSTEM,
      null,
      'gpt-5.4-mini',
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not read your export. Try a shorter paste.' }, { status: 502 });
    }

    const extracted = JSON.parse(stripJsonFences(jsonMatch[0])) as ImportedVoiceProfile;

    return NextResponse.json({
      displayName: extracted.display_name?.trim() || null,
      bio: extracted.bio_facts?.trim() || null,
      voiceDescription: extracted.voice_description?.trim() || null,
      voiceRules: extracted.voice_rules?.trim() || null,
    });
  } catch (err) {
    return errorResponse('Import failed.', 502, err);
  }
}
