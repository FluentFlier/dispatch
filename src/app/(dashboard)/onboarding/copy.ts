import { PRODUCT_NAME } from '@/lib/brand';
import type { StepKey } from './resolve-step';

/**
 * Every user-facing string in onboarding. Centralised so copy is reviewable in
 * one place and translation stays possible later. Step components must not
 * inline literals.
 */
export const COPY = {
  eyebrow: `${PRODUCT_NAME} setup`,

  steps: {
    you: {
      title: 'Tell us who you are',
      subtitle: 'Two quick details. Everything else we work out for you.',
      nameLabel: 'Your name',
      namePlaceholder: 'Your name or brand',
      focusLabel: 'What do you post about?',
      focusPlaceholder: 'Building a fintech startup, hiring, and founder-led sales',
      focusHint: 'One line is plenty. We use it to set up your content pillars.',
    },
    connect: {
      title: 'Connect your accounts',
      subtitle:
        'Link LinkedIn or X and we learn your voice from your real posts. You can skip this and do it later.',
      linkedinLabel: 'LinkedIn',
      xLabel: 'X',
      gmailLabel: 'Gmail',
      gmailHint: 'Optional. Sent emails make your 1:1 voice sharper.',
      notConnected: 'Not connected',
      connectedLabel: 'Connected',
      connect: 'Connect',
      connecting: 'Connecting...',
      connectCta: 'Connect LinkedIn or X',
      connectAnother: 'Connect another account',
      unipileUnavailable: 'Social connect is finishing setup. Try again shortly.',
      composioUnavailable: 'Gmail connect is not configured yet. Connect LinkedIn or X instead.',
      oauthFailed: 'That connection did not complete. Try again, or skip for now.',
    },
    profile: {
      title: 'Your profile',
      subtitle: 'This is what we sound like when we write for you. Edit anything that feels off.',
      voiceLabel: 'Voice',
      voicePlaceholder: 'How your content should sound',
      rulesLabel: 'Voice rules',
      rulesPlaceholder: 'One rule per line',
      pillarsLabel: 'Content pillars',
      pillarNamePlaceholder: 'Pillar name',
    },
  },

  building: {
    title: 'Building your profile',
    lines: [
      'Reading your posts...',
      'Analyzing your hooks...',
      'Learning your voice...',
      'Setting up your pillars...',
    ],
    timeout:
      'This is taking longer than usual. We will finish in the background - you can carry on now and refine your voice anytime in Voice Lab.',
  },

  footer: {
    back: 'Back',
    next: 'Continue',
    skip: 'Skip for now',
    finishToLeads: 'Set up Leads',
    finishToDashboard: 'Go to dashboard',
    saving: 'Saving...',
  },

  errors: {
    ingestFailed: 'We could not read your posts. You can continue and finish your voice later.',
    saveFailed: 'Could not save your profile. Please try again.',
    nameRequired: 'Add your name to continue.',
  },
} as const;

/** Accessible progress label, e.g. "Step 2 of 3, Connect your accounts". */
export function stepProgressLabel(step: StepKey, index: number, total: number): string {
  return `Step ${index + 1} of ${total}, ${COPY.steps[step].title}`;
}
