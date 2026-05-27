"use client";

interface ContextEditorProps {
  contextAdditions: string;
  onContextChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

export default function ContextEditor({
  contextAdditions,
  onContextChange,
  onSave,
  saving,
  saved,
}: ContextEditorProps) {
  return (
    <>
      <p className="text-sm text-text-secondary mb-3">
        Update this when something big changes. This text is appended to every
        AI call to keep the AI current.
      </p>
      <textarea
        value={contextAdditions}
        onChange={(e) => onContextChange(e.target.value)}
        onBlur={onSave}
        placeholder="Add context the AI should always know about you..."
        rows={20}
        className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-2.5 text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors resize-none mb-4"
      />
      <SaveButton onClick={onSave} loading={saving} saved={saved} />
    </>
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
