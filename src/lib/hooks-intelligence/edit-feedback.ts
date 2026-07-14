/**
 * Edit Feedback Logger
 * 
 * Inspired by high-ROI pattern from Imagine trial: track user corrections/edits to AI-generated content
 * so the system can learn and improve over time (tone, structure, hook quality, voice fidelity).
 * 
 * This feeds our existing Hook Intelligence RL scorer + dataset.
 * No direct code from the trial: pure conceptual replication using our stack.
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
    const key = 'content_os_edit_feedback';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push(feedback);
    localStorage.setItem(key, JSON.stringify(existing.slice(-50))); // keep last 50
  } catch {}

  // RL updates run server-side via /api/cron/intelligence-sync - avoid importing
  // rl-trainer here (pulls hook dataset + prod-mining into the client bundle).
  void fetch('/api/hooks/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
  }).catch(() => undefined);
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
