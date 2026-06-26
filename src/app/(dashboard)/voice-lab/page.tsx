"use client";

import { useState, useCallback } from "react";
import { Loader2, Plus, X, Copy, Check, ChevronRight, Sparkles, Mic, FileText, Download, Link2 } from "lucide-react";

type Step = "samples" | "analyzing" | "interview" | "synthesizing" | "result";

interface Sample {
  content: string;
  platform: string;
  sourceUrl?: string;
}

interface GapQuestion {
  id: string;
  question: string;
  why: string;
}

interface Analysis {
  analysis: Record<string, unknown>;
  voice_summary: string;
  voice_rules: string[];
  gap_questions: GapQuestion[];
}

interface Persona {
  voice_description: string;
  voice_rules: string;
  vocabulary_fingerprint: {
    uses_often: string[];
    never_uses: string[];
    signature_phrases: string[];
  };
  structural_patterns: {
    avg_sentence_length: string;
    paragraph_style: string;
    hook_pattern: string;
    closing_pattern: string;
  };
  exportable_prompt: string;
}

const PLATFORMS = ["Twitter/X", "LinkedIn", "Instagram", "Threads", "Other"];

export default function VoiceLabPage() {
  const [step, setStep] = useState<Step>("samples");
  const [samples, setSamples] = useState<Sample[]>([{ content: "", platform: "Twitter/X" }]);
  const [importUrls, setImportUrls] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [persona, setPersona] = useState<Persona | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addSample = useCallback(() => {
    if (samples.length >= 20) return;
    setSamples((prev) => [...prev, { content: "", platform: "Twitter/X" }]);
  }, [samples.length]);

  const removeSample = useCallback((index: number) => {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateSample = useCallback((index: number, field: keyof Sample, value: string) => {
    setSamples((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }, []);

  const validSamples = samples.filter((s) => s.content.trim().length > 10);

  async function importSamplesFromUrls() {
    const urls = importUrls
      .split(/\s+/)
      .map((url) => url.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setError("Paste at least one public URL");
      return;
    }

    setImporting(true);
    setError(null);
    setImportMessage("");

    try {
      const res = await fetch("/api/voice-lab/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      const imported = (data.samples || []) as Sample[];
      if (imported.length === 0) {
        setImportMessage("No usable writing found. Try a public article, post, newsletter, or portfolio page.");
        return;
      }

      setSamples((prev) => {
        const nonEmpty = prev.filter((sample) => sample.content.trim().length > 0);
        return [...nonEmpty, ...imported].slice(0, 20);
      });
      setImportUrls("");
      const failed = data.failures?.length ? ` ${data.failures.length} URL failed.` : "";
      setImportMessage(`Imported ${imported.length} voice samples.${failed}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function analyzeSamples() {
    if (validSamples.length < 3) {
      setError("Add at least 3 content samples for accurate analysis");
      return;
    }
    setError(null);
    setStep("analyzing");

    try {
      const res = await fetch("/api/voice-lab/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: validSamples }),
      });

      if (!res.ok) throw new Error("Analysis failed");

      const data: Analysis = await res.json();
      setAnalysis(data);

      const initial: Record<string, string> = {};
      data.gap_questions.forEach((q) => { initial[q.id] = ""; });
      setAnswers(initial);

      setStep("interview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStep("samples");
    }
  }

  async function synthesizePersona() {
    if (!analysis) return;
    setStep("synthesizing");
    setError(null);

    const answeredQuestions = analysis.gap_questions
      .filter((q) => answers[q.id]?.trim())
      .map((q) => ({
        questionId: q.id,
        question: q.question,
        answer: answers[q.id],
      }));

    try {
      const res = await fetch("/api/voice-lab/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: analysis.analysis,
          answers: answeredQuestions,
        }),
      });

      if (!res.ok) throw new Error("Synthesis failed");

      const data: Persona = await res.json();
      setPersona(data);
      setStep("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Synthesis failed");
      setStep("interview");
    }
  }

  async function savePersona() {
    if (!persona) return;
    setSaving(true);

    try {
      const res = await fetch("/api/voice-lab/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...persona,
          sample_posts: validSamples,
        }),
      });

      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function copyExportPrompt() {
    if (!persona) return;
    navigator.clipboard.writeText(persona.exportable_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-md bg-coral-light flex items-center justify-center">
          <Mic className="w-5 h-5 text-accent-primary" />
        </div>
        <div>
          <p className="page-eyebrow mb-2">VOICE LAB</p>
          <h1 className="page-title">Your voice</h1>
          <p className="page-subtitle">Paste your best posts. We learn how you write so every draft sounds like you.</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 text-[12px]">
        {(["samples", "interview", "result"] as const).map((s, i) => {
          const labels = ["1. Paste Content", "2. Voice Interview", "3. Your Persona"];
          const isActive = step === s || (s === "samples" && step === "analyzing") || (s === "interview" && step === "synthesizing");
          const isDone =
            (s === "samples" && ["interview", "synthesizing", "result"].includes(step)) ||
            (s === "interview" && step === "result");
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="w-3 h-3 text-text-tertiary" />}
              <span className={`px-2.5 py-1 rounded-full ${
                isDone
                  ? "bg-sage-light text-accent-secondary"
                  : isActive
                    ? "bg-coral-light text-accent-primary"
                    : "bg-bg-tertiary text-text-tertiary"
              }`}>
                {labels[i]}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-800">
          {error}
        </div>
      )}

      {/* Step 1: Paste Samples */}
      {step === "samples" && (
        <div className="space-y-4">
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">
                  Import from public links
                </h2>
                <p className="mt-1 text-[13px] text-text-secondary">
                  Paste posts, articles, newsletters, blogs, or profile links. We pull the writing and turn it into samples.
                </p>
              </div>
              <Link2 className="h-5 w-5 text-accent-primary shrink-0" />
            </div>
            <textarea
              value={importUrls}
              onChange={(e) => setImportUrls(e.target.value)}
              rows={3}
              placeholder="https://yourblog.com/post&#10;https://x.com/you/status/...&#10;https://www.linkedin.com/posts/..."
              className="w-full bg-bg-tertiary border border-border rounded-lg px-4 py-3 text-[13px] text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-accent-primary/40"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-text-tertiary">
                Works best with public writing pages. Private or logged-in social content may need copy/paste.
              </p>
              <button
                type="button"
                onClick={importSamplesFromUrls}
                disabled={importing || !importUrls.trim()}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md bg-[#101312] px-4 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {importing ? "Importing..." : "Import voice"}
              </button>
            </div>
            {importMessage && (
              <p className="rounded-md bg-sage-light px-3 py-2 text-[12px] text-accent-secondary">{importMessage}</p>
            )}
          </div>

          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">
                Paste or edit samples
              </h2>
              <span className="section-label">{validSamples.length} valid samples</span>
            </div>
            <p className="text-[13px] text-text-secondary">
              Add 5-15 posts that represent your voice at its best. Mix platforms for a richer profile.
            </p>

            {samples.map((sample, index) => (
              <div key={index} className="space-y-2 p-4 rounded-lg bg-bg-tertiary border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p}
                        onClick={() => updateSample(index, "platform", p)}
                        className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
                          sample.platform === p
                            ? "bg-coral-light text-accent-primary"
                            : "bg-bg-tertiary text-text-tertiary hover:text-text-secondary"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  {samples.length > 1 && (
                    <button onClick={() => removeSample(index)} className="text-text-tertiary hover:text-text-tertiary">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <textarea
                  value={sample.content}
                  onChange={(e) => updateSample(index, "content", e.target.value)}
                  placeholder="Paste a post, tweet, or caption..."
                  rows={3}
                  className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none"
                />
                {sample.sourceUrl && (
                  <p className="truncate text-[11px] text-text-tertiary">Imported from {sample.sourceUrl}</p>
                )}
              </div>
            ))}

            <button
              onClick={addSample}
              disabled={samples.length >= 20}
              className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-tertiary disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" /> Add another sample
            </button>
          </div>

          <button
            onClick={analyzeSamples}
            disabled={validSamples.length < 3}
            className="w-full py-3 rounded-lg font-medium text-[14px] transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-accent-primary text-white hover:bg-accent-dark"
          >
            <span className="flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />
              Analyze Voice ({validSamples.length} samples)
            </span>
          </button>
        </div>
      )}

      {/* Analyzing spinner */}
      {step === "analyzing" && (
        <div className="bg-bg-secondary border border-border rounded-lg p-12 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
          <p className="text-[14px] text-text-tertiary">Analyzing your voice patterns...</p>
          <p className="text-[12px] text-text-tertiary">Reading sentence structure, tone, vocabulary, and quirks</p>
        </div>
      )}

      {/* Step 2: Voice Interview */}
      {step === "interview" && analysis && (
        <div className="space-y-4">
          {/* Analysis Summary */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-3">
            <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Voice Snapshot</h2>
            <p className="text-[13px] text-text-tertiary leading-relaxed">{analysis.voice_summary}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {analysis.voice_rules.slice(0, 6).map((rule, i) => (
                <span key={i} className={`text-[11px] px-2.5 py-1 rounded-full ${
                  rule.startsWith("DO")
                    ? "bg-sage-light text-accent-secondary"
                    : "bg-red-50 text-red-800"
                }`}>
                  {rule}
                </span>
              ))}
            </div>
          </div>

          {/* Gap Questions */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
            <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Quick Voice Interview</h2>
            <p className="text-[13px] text-text-secondary">
              Answer these to fill in what the AI could not tell from your writing alone. Skip any you want.
            </p>

            {analysis.gap_questions.map((q) => (
              <div key={q.id} className="space-y-2">
                <label className="text-[13px] text-text-primary font-medium">{q.question}</label>
                <p className="text-[11px] text-text-tertiary">{q.why}</p>
                <textarea
                  value={answers[q.id] || ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Your answer..."
                  rows={2}
                  className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-accent-primary/40"
                />
              </div>
            ))}
          </div>

          <button
            onClick={synthesizePersona}
            className="w-full py-3 rounded-lg font-medium text-[14px] bg-accent-primary text-white hover:bg-accent-dark transition-all"
          >
            <span className="flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />
              Build My Persona
            </span>
          </button>
        </div>
      )}

      {/* Synthesizing spinner */}
      {step === "synthesizing" && (
        <div className="bg-bg-secondary border border-border rounded-lg p-12 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
          <p className="text-[14px] text-text-tertiary">Crafting your persona...</p>
          <p className="text-[12px] text-text-tertiary">Merging analysis with your interview answers</p>
        </div>
      )}

      {/* Step 3: Persona Result */}
      {step === "result" && persona && (
        <div className="space-y-4">
          {/* Voice Description */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-3">
            <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Your Voice</h2>
            <p className="font-serif text-[17px] text-ink2 leading-[1.5]">{persona.voice_description}</p>
          </div>

          {/* Voice Rules */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-3">
            <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Voice Rules</h2>
            <pre className="text-[12px] text-text-tertiary whitespace-pre-wrap leading-relaxed font-mono bg-bg-tertiary rounded-lg p-4">
              {persona.voice_rules}
            </pre>
          </div>

          {/* Vocabulary */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-3">
            <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Vocabulary Fingerprint</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="section-label mb-1.5">Uses Often</p>
                <div className="flex flex-wrap gap-1">
                  {persona.vocabulary_fingerprint.uses_often?.map((w) => (
                    <span key={w} className="text-[11px] px-2 py-0.5 rounded-full bg-coral-light text-accent-primary">{w}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="section-label mb-1.5">Never Uses</p>
                <div className="flex flex-wrap gap-1">
                  {persona.vocabulary_fingerprint.never_uses?.map((w) => (
                    <span key={w} className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-800">{w}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="section-label mb-1.5">Signature Phrases</p>
                <div className="flex flex-wrap gap-1">
                  {persona.vocabulary_fingerprint.signature_phrases?.map((w) => (
                    <span key={w} className="text-[11px] px-2 py-0.5 rounded-full bg-sage-light text-accent-secondary">{w}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Exportable Prompt */}
          <div className="bg-bg-secondary border border-border rounded-lg p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-[19px] font-normal tracking-[-0.02em] text-ink">Exportable Persona Prompt</h2>
              <button
                onClick={copyExportPrompt}
                className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-tertiary transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-accent-secondary" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[11px] text-text-tertiary">Use this in Claude, ChatGPT, or any LLM to write in your voice</p>
            <pre className="text-[12px] text-text-tertiary whitespace-pre-wrap leading-relaxed font-mono bg-bg-tertiary border border-border rounded-lg p-4 max-h-[300px] overflow-y-auto">
              {persona.exportable_prompt}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={savePersona}
              disabled={saving}
              className="flex-1 py-3 rounded-lg font-medium text-[14px] transition-all bg-accent-primary text-white hover:bg-accent-dark disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {saved ? "Saved to Profile!" : saving ? "Saving..." : "Save to Profile"}
            </button>
            <button
              onClick={copyExportPrompt}
              className="px-6 py-3 rounded-lg font-medium text-[14px] transition-all bg-bg-tertiary text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>

          {/* Start Over */}
          <button
            onClick={() => { setStep("samples"); setAnalysis(null); setPersona(null); setError(null); }}
            className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Start over with new samples
          </button>
        </div>
      )}
    </div>
  );
}
