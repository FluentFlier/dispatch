"use client";

import { useEffect, useState } from "react";
import type { ContentPillarConfig } from "@/types/database";
import { normalizePillarSlug, clampWeight, DEFAULT_PILLAR_WEIGHT } from "@/lib/pillars";
// Type-only import: avoids bundling the server-side hook dataset into the client.
import type { PillarSuggestion } from "@/lib/pillar-catalog";
import { isPillarCovered } from "@/lib/pillar-dedup";

/** Canonical pillar slug (underscore/space tolerant); shared with the rest of the app. */
const pillarSlug = normalizePillarSlug;

const PRESET_COLORS = [
  "#E07A5F",
  "#F59E0B",
  "#10B981",
  "#8B5CF6",
  "#3D8B7A",
  "#5A5047",
];

const MAX_PILLARS = 10;

interface ProfileEditorProps {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  bioFacts: string;
  onBioFactsChange: (value: string) => void;
  voiceDescription: string;
  onVoiceDescriptionChange: (value: string) => void;
  voiceRules: string;
  onVoiceRulesChange: (value: string) => void;
  pillars: ContentPillarConfig[];
  onPillarsChange: (pillars: ContentPillarConfig[]) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

export default function ProfileEditor({
  displayName,
  onDisplayNameChange,
  bioFacts,
  onBioFactsChange,
  voiceDescription,
  onVoiceDescriptionChange,
  voiceRules,
  onVoiceRulesChange,
  pillars,
  onPillarsChange,
  onSave,
  saving,
  saved,
}: ProfileEditorProps) {
  function addPillar() {
    if (pillars.length >= MAX_PILLARS) return;
    onPillarsChange([
      ...pillars,
      { name: "", color: PRESET_COLORS[0], description: "", promptTemplate: "", weight: DEFAULT_PILLAR_WEIGHT },
    ]);
  }

  /** Adds a suggested/trending pillar to the user's set (skips dupes + cap). */
  function addSuggestion(s: PillarSuggestion) {
    if (pillars.length >= MAX_PILLARS) return;
    const exists = pillars.some(
      (p) => pillarSlug(p.name) === s.slug || p.name.toLowerCase() === s.name.toLowerCase(),
    );
    if (exists) return;
    const color = PRESET_COLORS[pillars.length % PRESET_COLORS.length];
    onPillarsChange([
      ...pillars,
      { name: s.name, color, description: s.description, promptTemplate: "", weight: DEFAULT_PILLAR_WEIGHT },
    ]);
  }

  function removePillar(index: number) {
    if (pillars.length <= 1) return;
    onPillarsChange(pillars.filter((_, i) => i !== index));
  }

  function updatePillar(
    index: number,
    field: keyof ContentPillarConfig,
    value: string
  ) {
    const updated = [...pillars];
    updated[index] = { ...updated[index], [field]: value };
    onPillarsChange(updated);
  }

  /** Update the numeric importance weight (1-100) for a profile pillar. */
  function updatePillarWeight(index: number, value: number) {
    const updated = [...pillars];
    updated[index] = { ...updated[index], weight: clampWeight(value) };
    onPillarsChange(updated);
  }

  return (
    <>
      <div className="space-y-5 mb-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            placeholder="Your name or brand"
            className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            Bio facts
          </label>
          <textarea
            value={bioFacts}
            onChange={(e) => onBioFactsChange(e.target.value)}
            placeholder="Key facts about you..."
            rows={4}
            className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            Voice description
          </label>
          <textarea
            value={voiceDescription}
            onChange={(e) => onVoiceDescriptionChange(e.target.value)}
            placeholder="How your content should sound..."
            rows={4}
            className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            Voice rules
          </label>
          <textarea
            value={voiceRules}
            onChange={(e) => onVoiceRulesChange(e.target.value)}
            placeholder="Hard rules for the AI..."
            rows={3}
            className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none"
          />
        </div>

        {/* Content Pillars */}
        <div>
          <label className="block text-sm text-text-secondary mb-3">
            Content pillars
          </label>
          <div className="space-y-4">
            {pillars.map((pillar, i) => (
              <div
                key={i}
                className="border border-border rounded-lg p-5 space-y-4"
                style={{
                  borderLeftColor: pillar.color,
                  borderLeftWidth: 3,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">
                    Pillar {i + 1}
                  </span>
                  {pillars.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePillar(i)}
                      className="text-xs text-text-secondary hover:text-accent-primary transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="flex gap-3">
                  <input
                    type="text"
                    value={pillar.name}
                    onChange={(e) => updatePillar(i, "name", e.target.value)}
                    placeholder="Pillar name"
                    className="flex-1 bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors"
                  />
                  <div className="flex gap-1.5 items-center">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => updatePillar(i, "color", color)}
                        className={`w-7 h-7 rounded-full transition-transform ${
                          pillar.color === color
                            ? "ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-secondary scale-110"
                            : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-text-secondary w-28 shrink-0">
                    Importance
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={pillar.weight ?? DEFAULT_PILLAR_WEIGHT}
                    onChange={(e) => updatePillarWeight(i, Number(e.target.value))}
                    className="flex-1 accent-accent-primary"
                    aria-label={`${pillar.name || "Pillar"} importance`}
                  />
                  <span className="text-[11px] text-text-secondary w-8 text-right tabular-nums">
                    {pillar.weight ?? DEFAULT_PILLAR_WEIGHT}
                  </span>
                </div>

                <textarea
                  value={pillar.description || ""}
                  onChange={(e) =>
                    updatePillar(i, "description", e.target.value)
                  }
                  placeholder="What this pillar covers..."
                  rows={2}
                  className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none"
                />

                <textarea
                  value={pillar.promptTemplate || ""}
                  onChange={(e) =>
                    updatePillar(i, "promptTemplate", e.target.value)
                  }
                  placeholder="AI prompt template for this pillar..."
                  rows={3}
                  className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none"
                />
              </div>
            ))}

            {pillars.length < MAX_PILLARS && (
              <button
                type="button"
                onClick={addPillar}
                className="w-full border border-dashed border-border rounded-lg py-3 text-sm text-text-secondary hover:border-accent-primary hover:text-accent-primary transition-colors"
              >
                + Add custom pillar
              </button>
            )}
          </div>

          <PillarBrowser
            existing={pillars}
            onAdd={addSuggestion}
            atCap={pillars.length >= MAX_PILLARS}
          />
        </div>
      </div>

      <SaveButton onClick={onSave} loading={saving} saved={saved} />
    </>
  );
}

/**
 * Browse + search optional pillars (curated catalog + data-driven trending) and
 * add them to your set. Your voice pillars stay the default; this is additive,
 * so you are never locked into a fixed list.
 */
function PillarBrowser({
  existing,
  onAdd,
  atCap,
}: {
  existing: ContentPillarConfig[];
  onAdd: (s: PillarSuggestion) => void;
  atCap: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [curated, setCurated] = useState<PillarSuggestion[]>([]);
  const [trending, setTrending] = useState<PillarSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pillars/suggestions", { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setCurated(data.curated ?? []);
        setTrending(data.trending ?? []);
      } catch {
        /* suggestions are optional */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const existingSlugs = new Set(existing.map((p) => pillarSlug(p.name)));
  const existingNames = existing.map((p) => p.name);
  const q = query.trim().toLowerCase();
  // Trending first, then curated; de-dupe by slug; drop ones the user already
  // has (incl. aliases like AI vs Artificial Intelligence); filter by search.
  const all = [...trending, ...curated]
    .filter((s, i, arr) => arr.findIndex((x) => x.slug === s.slug) === i)
    .filter((s) => !isPillarCovered(existingNames, s.name));
  const filtered = q
    ? all.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    : all;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-sm text-accent-primary hover:underline"
      >
        Browse suggested &amp; trending pillars
      </button>
    );
  }

  return (
    <div className="mt-4 border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary">Add pillars</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Close
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search pillars..."
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors"
      />

      {atCap && (
        <p className="text-xs text-text-secondary">
          You have reached the {MAX_PILLARS}-pillar limit. Remove one to add more.
        </p>
      )}

      {!loaded ? (
        <p className="text-xs text-text-secondary">Loading suggestions...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-text-secondary">No matching pillars.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filtered.map((s) => {
            const added = existingSlugs.has(s.slug);
            return (
              <button
                key={s.slug}
                type="button"
                disabled={added || atCap}
                onClick={() => onAdd(s)}
                title={s.description}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  added
                    ? "border-border text-text-secondary opacity-60 cursor-default"
                    : "border-border text-text-primary hover:border-accent-primary hover:text-accent-primary"
                }`}
              >
                <span>{s.name}</span>
                {s.tag === "trending" && (
                  <span className="text-[9px] tracking-wide text-accent-primary">Trending</span>
                )}
                <span className="text-text-secondary">{added ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SaveButton({
  onClick,
  loading,
  saved,
}: {
  onClick: () => void;
  loading: boolean;
  saved: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={onClick}
        className="px-5 py-2 rounded-lg bg-accent-primary text-white font-medium text-sm hover:bg-accent-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Saving..." : "Save"}
      </button>
      {saved && (
        <span className="text-sm text-[#3B6D11] animate-fade-in">Saved!</span>
      )}
    </div>
  );
}
