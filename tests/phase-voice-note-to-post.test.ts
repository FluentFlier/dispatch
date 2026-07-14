/**
 * Phase: Voice Note -> Post
 *
 * Verifies the transcription endpoint that powers the voice-note Compose flow.
 * The endpoint was previously orphaned + unauthenticated; this phase wires it
 * into the UI, so it must now enforce auth, the AI usage guard, and input
 * validation before calling the (paid) HuggingFace ASR model.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
}));
vi.mock('@/lib/ai-guard', () => ({
  guardAiRequest: vi.fn(),
}));
vi.mock('@/lib/huggingface', () => ({
  transcribeAudioHF: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { getAuthenticatedUser } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { transcribeAudioHF } from '@/lib/huggingface';
import { POST } from '@/app/api/audio/transcribe/route';

const mockUser = { id: 'user_123' };

/** Build a POST request carrying an optional audio blob under the `audio` field. */
function makeRequest(audio?: Blob): Request {
  const form = new FormData();
  if (audio) form.append('audio', audio, 'note.webm');
  return new Request('http://localhost/api/audio/transcribe', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  (guardAiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  (transcribeAudioHF as ReturnType<typeof vi.fn>).mockResolvedValue('hello world');
});

describe('Phase: Voice Note -> Post', () => {
  describe('POST /api/audio/transcribe - auth + guard', () => {
    it('returns 401 when unauthenticated', async () => {
      (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })) as never);
      expect(res.status).toBe(401);
      expect(transcribeAudioHF).not.toHaveBeenCalled();
    });

    it('propagates the AI guard status when the guard rejects', async () => {
      (guardAiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: 'Usage limit reached',
        status: 429,
      });
      const res = await POST(makeRequest(new Blob(['x'], { type: 'audio/webm' })) as never);
      expect(res.status).toBe(429);
      expect(transcribeAudioHF).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/audio/transcribe - input validation', () => {
    it('returns 400 when no audio field is present', async () => {
      const res = await POST(makeRequest() as never);
      expect(res.status).toBe(400);
      expect(transcribeAudioHF).not.toHaveBeenCalled();
    });

    it('returns 400 when the audio blob is empty', async () => {
      const res = await POST(makeRequest(new Blob([], { type: 'audio/webm' })) as never);
      expect(res.status).toBe(400);
      expect(transcribeAudioHF).not.toHaveBeenCalled();
    });

    it('returns 413 when the audio exceeds the size cap', async () => {
      const tooBig = new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: 'audio/webm' });
      const res = await POST(makeRequest(tooBig) as never);
      expect(res.status).toBe(413);
      expect(transcribeAudioHF).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/audio/transcribe - happy path + errors', () => {
    it('returns the transcript on a valid audio blob', async () => {
      const res = await POST(makeRequest(new Blob(['audio-bytes'], { type: 'audio/webm' })) as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.text).toBe('hello world');
      expect(transcribeAudioHF).toHaveBeenCalledOnce();
    });

    it('returns 500 when transcription fails', async () => {
      (transcribeAudioHF as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('HF down'));
      const res = await POST(makeRequest(new Blob(['audio-bytes'], { type: 'audio/webm' })) as never);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('HF down');
    });
  });
});
