'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { PLATFORMS } from '@/lib/constants';
import type { DashboardPlatform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useCreatorPreferences } from '@/hooks/useCreatorPreferences';

/**
 * Sends a recorded audio blob to the transcription endpoint and returns the text.
 * WHY separate from generate: transcription is imperfect, so we surface the raw
 * text for the user to edit before it becomes the generation prompt.
 */
async function transcribe(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('audio', blob, 'voice-note.webm');
  const res = await fetchWithAuth('/api/audio/transcribe', { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Transcription failed');
  }
  const data = await res.json();
  return (data.text as string) ?? '';
}

/**
 * Runs the (edited) transcript through the voice-aware generation pipeline.
 * Reuses /api/generate so the output stays in the creator's voice, identical
 * to the text-first Compose flow.
 */
async function callGenerate(
  prompt: string,
  platform: DashboardPlatform,
  useVoice: boolean,
): Promise<{ text: string; voiceMetrics: GenerateVoiceMetrics }> {
  const res = await fetchWithAuth('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, platform, topic: prompt.slice(0, 200), useVoice }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Generation failed');
  }
  const data = await res.json();
  return {
    text: data.text,
    voiceMetrics: {
      voice_match_score: data.voice_match_score,
      ai_score: data.ai_score,
      iterations: data.iterations,
      revised: data.revised,
      evaluation: data.evaluation,
    },
  };
}

type RecState = 'idle' | 'recording' | 'transcribing' | 'ready';

/**
 * Voice-note capture: record a spoken idea, transcribe it, edit the transcript,
 * then generate an in-voice draft. Closes the "send a voice note, get a post"
 * gap by wiring the existing (previously orphaned) transcribe endpoint into the
 * generation pipeline.
 */
export function VoiceCapture() {
  const [recState, setRecState] = useState<RecState>('idle');
  const [transcript, setTranscript] = useState('');
  const [platform, setPlatform] = useState<DashboardPlatform>('linkedin');
  const [output, setOutput] = useState('');
  const [voiceMetrics, setVoiceMetrics] = useState<GenerateVoiceMetrics | undefined>();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const { voiceEnabled, loading: prefLoading } = useCreatorPreferences();
  const [useVoice, setUseVoice] = useState(true);
  useEffect(() => {
    if (!prefLoading) setUseVoice(voiceEnabled);
  }, [prefLoading, voiceEnabled]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Release the mic when the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecState('transcribing');
        try {
          const text = await transcribe(blob);
          setTranscript((prev) => (prev ? `${prev} ${text}` : text));
          setRecState('ready');
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'Transcription failed');
          setRecState(transcript ? 'ready' : 'idle');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecState('recording');
    } catch {
      setError('Microphone permission denied or unavailable.');
      setRecState('idle');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const reset = () => {
    setTranscript('');
    setOutput('');
    setVoiceMetrics(undefined);
    setError('');
    setRecState('idle');
  };

  const generate = async () => {
    if (generating || !transcript.trim()) return;
    setGenerating(true);
    setError('');
    setOutput('');
    setVoiceMetrics(undefined);
    try {
      const result = await callGenerate(transcript.trim(), platform, useVoice);
      setOutput(result.text);
      setVoiceMetrics(result.voiceMetrics);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const isRecording = recState === 'recording';
  const isTranscribing = recState === 'transcribing';

  return (
    <div className="space-y-5">
      <div>
        <label className="block section-label mb-2">Record a voice note</label>
        <div className="flex items-center gap-3">
          {!isRecording ? (
            <Button onClick={startRecording} loading={isTranscribing} disabled={isTranscribing}>
              <Mic className="mr-2 h-4 w-4" />
              {transcript ? 'Record more' : 'Start recording'}
            </Button>
          ) : (
            <Button onClick={stopRecording} variant="secondary">
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          )}
          {isRecording && (
            <span className="flex items-center gap-2 font-body text-[13px] text-flame">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-flame" />
              Recording…
            </span>
          )}
          {isTranscribing && (
            <span className="font-body text-[13px] text-ink2">Transcribing…</span>
          )}
          {(transcript || output) && !isRecording && !isTranscribing && (
            <button
              onClick={reset}
              className="flex items-center gap-1 font-body text-[12px] text-ink3 hover:text-ink"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>
        <p className="mt-2 font-body text-[12px] text-text-secondary">
          Speak your idea out loud. We transcribe it, you edit, then generate a draft in your voice.
        </p>
      </div>

      <div>
        <label className="block section-label mb-2">Transcript (edit before generating)</label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={5}
          placeholder="Your transcribed voice note appears here. You can also type or paste."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none transition-colors duration-100"
        />
      </div>

      <div>
        <label className="block section-label mb-2">Target Platform</label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
              style={{
                backgroundColor: '#F3EDE4',
                color: platform === p ? '#1C1917' : '#78716C',
                border: platform === p
                  ? '1.5px solid rgba(28, 25, 23, 0.28)'
                  : '1px solid rgba(28, 25, 23, 0.1)',
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-bg-tertiary px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-text-primary">Use my voice</p>
          <p className="text-[11px] text-text-secondary">
            {useVoice
              ? 'Draft sounds like you.'
              : 'Off: clean, neutral draft with no personal voice applied.'}
          </p>
        </div>
        <Toggle checked={useVoice} onChange={setUseVoice} label="Use my voice" />
      </div>

      <Button onClick={generate} loading={generating} disabled={!transcript.trim()}>
        Generate from voice note
      </Button>

      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}

      <GenerateOutput
        text={output}
        loading={generating}
        sourcePlatform={platform}
        voiceMetrics={voiceMetrics}
        onTextUpdate={(newText) => setOutput(newText)}
      />
    </div>
  );
}
