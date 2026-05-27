"use client";

import type { Platform } from "@/lib/constants";
import { PLATFORMS } from "@/lib/constants";

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  threads: "Threads",
};

interface PlatformDefaultsProps {
  defaultPlatform: Platform;
  onDefaultPlatformChange: (platform: Platform) => void;
  crossPostReminders: boolean;
  onCrossPostRemindersChange: (value: boolean) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

export default function PlatformDefaults({
  defaultPlatform,
  onDefaultPlatformChange,
  crossPostReminders,
  onCrossPostRemindersChange,
  onSave,
  saving,
  saved,
}: PlatformDefaultsProps) {
  return (
    <>
      <div className="space-y-4 mb-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            Default platform
          </label>
          <select
            value={defaultPlatform}
            onChange={(e) =>
              onDefaultPlatformChange(e.target.value as Platform)
            }
            className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-hover transition-colors"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-primary">
            Cross-post reminders
          </span>
          <Toggle
            enabled={crossPostReminders}
            onChange={onCrossPostRemindersChange}
          />
        </div>
      </div>
      <SaveButton onClick={onSave} loading={saving} saved={saved} />
    </>
  );
}

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? "bg-accent-primary" : "bg-bg-tertiary"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
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
