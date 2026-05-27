/**
 * Edit Feedback Logger
 * 
 * Inspired by high-ROI pattern from Imagine trial: track user corrections/edits to AI-generated content
 * so the system can learn and improve over time (tone, structure, hook quality, voice fidelity).
 * 
 * This feeds our existing Hook Intelligence RL scorer + dataset.
 * No direct code from the trial – pure conceptual replication using our stack.
 */

import type { HookVertical } from './types';

export interface EditFeedbackPayload {
  postId: string;
  originalContent: {
    hook?: string;
    script?: string;
    caption?: string;
  };
  editedContent: {
    hook?: string;
    script?: string;
    caption?: string;
  };
  pillar: string;
  platform: string;
}

export async function logEditFeedback(payload: EditFeedbackPayload) {
  // In production: send to API or directly update our hook-intelligence dataset / reinforcement
  // For now: console + localStorage for immediate visibility during development
  // Later: call updateHookPerformance or add to a "edits" table that retrains scorer

  const diffs = calculateSimpleDiffs(payload.originalContent, payload.editedContent);

  if (diffs.totalChanges === 0) return; // No meaningful edit

  const feedback = {
    ...payload,
    diffs,
    timestamp: new Date().toISOString(),
    changeMagnitude: diffs.totalChanges / 100, // rough 0-1 scale
  };

  console.log('[Hook Intelligence] Edit feedback captured (Imagine-inspired continuous learning):', feedback);

  // Persist lightly for now (can be picked up by research script or future cron)
  try {
    const key = 'dispatch_edit_feedback';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push(feedback);
    localStorage.setItem(key, JSON.stringify(existing.slice(-50))); // keep last 50
  } catch {}

  // Wire to RL / reinforcement (continuing from Imagine-inspired edit learning)
  try {
    const { updateFromEdits } = await import('./rl-trainer');
    // Significant edits become negative training signal for the patterns that were too far from voice
    if ((diffs as any).hook || (diffs as any).script) {
      updateFromEdits([{
        originalHookText: payload.originalContent.hook || payload.originalContent.script || '',
        editedHookText: payload.editedContent.hook || payload.editedContent.script || '',
        magnitude: Math.min(100, Math.max(10, Math.round(diffs.totalChanges / 5))),
      }]);
      console.log('[Edit Feedback → RL] Significant edit fed to trainer for score adjustment.');
    }
  } catch (e) {
    console.warn('[Edit Feedback] RL update skipped:', e);
  }
}

function calculateSimpleDiffs(original: any, edited: any) {
  let totalChanges = 0;
  const fields = ['hook', 'script', 'caption'] as const;

  const changes: Record<string, boolean> = {};

  for (const field of fields) {
    const o = (original[field] || '').trim();
    const e = (edited[field] || '').trim();
    if (o !== e) {
      changes[field] = true;
      totalChanges += Math.abs(e.length - o.length) + 10; // crude diff signal
    }
  }

  return {
    ...changes,
    totalChanges,
  };
}
