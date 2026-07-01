import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioHF } from '@/lib/huggingface';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { logError } from '@/lib/logger';

/** Reject audio larger than this to bound HF cost and request time. ~25MB. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Transcribes a user-recorded voice note into text via HuggingFace ASR.
 * WHY auth + guard: this is a paid AI call now exposed in the Compose UI
 * (voice-note capture), so it must be authenticated and pass the same
 * usage/rate guard as text generation to prevent quota abuse.
 * Returns { text } which the client then feeds into /api/generate.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
  }

  const file = formData.get('audio');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No valid audio file provided.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Audio file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio file too large (max 25MB).' }, { status: 413 });
  }

  try {
    const text = await transcribeAudioHF(file);
    return NextResponse.json({ text });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to transcribe audio';
    logError('[Transcribe API] Error', undefined, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
