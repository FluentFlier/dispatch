'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useToast } from '@/components/ui/Toast';

/**
 * Small inline "dictate" button: records audio, transcribes it via
 * /api/audio/transcribe, and hands the text back so it can fill a field. Reused
 * by the topic + braindump inputs so users can speak instead of type.
 */
export function MicDictate({ onText, title = 'Dictate' }: { onText: (text: string) => void; title?: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast('Recording not supported in this browser', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setState('transcribing');
        try {
          const form = new FormData();
          form.append('audio', blob, 'note.webm');
          const res = await fetchWithAuth('/api/audio/transcribe', { method: 'POST', body: form });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { toast((data as { error?: string }).error ?? 'Transcription failed', 'error'); }
          else if (data.text) onText(data.text as string);
        } catch {
          toast('Transcription failed', 'error');
        } finally {
          setState('idle');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
    } catch {
      toast('Microphone permission denied', 'error');
      setState('idle');
    }
  }

  function stop() { recorderRef.current?.stop(); }

  return (
    <button
      type="button"
      onClick={state === 'recording' ? stop : start}
      disabled={state === 'transcribing'}
      title={title}
      aria-label={title}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        state === 'recording'
          ? 'text-flame'
          : 'text-ink3 hover:bg-paper2 hover:text-ink2'
      }`}
    >
      {state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin" />
        : state === 'recording' ? <Square className="h-4 w-4 fill-current" />
        : <Mic className="h-4 w-4" />}
    </button>
  );
}
