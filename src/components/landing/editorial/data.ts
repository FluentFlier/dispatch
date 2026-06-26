/**
 * Static content for the editorial landing's two interactive sequences:
 * "The Loop" accordion and the dark "A Week in the Loop" timeline.
 * Kept out of the components so the section files stay focused on layout + behavior,
 * and so copy edits live in one place. Accent hexes are intentionally literal here
 * because several are per-step values that don't map to a single semantic token.
 */

export interface LoopStep {
  num: string;
  label: string;
  /** Per-step accent used for the active number, mark, and detail left-border. */
  accent: string;
  /** Mono mark shown at the right of the row when the step is inactive. */
  mark: string;
  lede: string;
  body: string;
  exLabel: string;
  ex: string;
}

export const LOOP_STEPS: LoopStep[] = [
  {
    num: '01',
    label: 'Signal',
    accent: '#2563EB',
    mark: 'CAPTURE',
    lede: 'Pull ideas from calendar events, notes, comments, and research.',
    body: 'Your life is the input. Capture ideas from calendar events, voice notes, comments, and saved posts — automatically routed into one Story Bank instead of seven scattered apps.',
    exLabel: 'INCOMING',
    ex: 'Podcast with YC founder — tomorrow 4:00pm',
  },
  {
    num: '02',
    label: 'Draft',
    accent: '#E8543A',
    mark: 'GENERATE',
    lede: 'Generate platform-native posts in your voice.',
    body: 'Native posts for X, LinkedIn, Instagram, and Threads — each scored against your voice fingerprint and hook intelligence before you ever see them.',
    exLabel: 'DRAFTED',
    ex: '“I stopped trying to be consistent…”',
  },
  {
    num: '03',
    label: 'Publish',
    accent: '#0F766E',
    mark: 'SCHEDULE',
    lede: 'Plan the week and ship across every platform from one place.',
    body: 'Batch a week of content, preview exact platform formatting, and schedule across every channel from a single calendar — no juggling five tabs at 1am.',
    exLabel: 'QUEUED',
    ex: 'LinkedIn + X · Tue 9:20 AM',
  },
  {
    num: '04',
    label: 'Reply',
    accent: '#E8543A',
    mark: 'ENGAGE',
    lede: 'Sync comments and draft thoughtful responses in your tone.',
    body: 'Comments and replies sync into one inbox. Content OS drafts on-voice responses and flags the high-signal threads worth turning into your next post.',
    exLabel: 'HIGH-SIGNAL',
    ex: '@0xfounder: “how do you batch this?”',
  },
  {
    num: '05',
    label: 'Learn',
    accent: '#2563EB',
    mark: 'COMPOUND',
    lede: 'Feed performance, replies, and winning hooks back into your Brain.',
    body: 'Performance, winning hooks, and high-signal replies flow back into your Creator Brain — so next week starts smarter than this one. The loop compounds.',
    exLabel: 'FED BACK',
    ex: 'Hook pattern → +18% above average',
  },
];

export interface WalkStep {
  num: string;
  label: string;
  tag: string;
  /** Per-step accent (cyan / coral / mint cycle) for tag, chip, and scene. */
  accent: string;
  line: string;
  sub: string;
  metric: string;
  big: string;
}

export const WALK_STEPS: WalkStep[] = [
  {
    num: 'MON 09:02',
    label: 'Calendar signal',
    tag: 'SIGNAL DETECTED',
    accent: '#5BC8FF',
    line: 'A calendar event becomes a content signal.',
    sub: 'Content OS spots your podcast with a YC founder tomorrow and surfaces it as a fresh angle before you even open the app.',
    metric: 'Signal confidence · 96%',
    big: '1',
  },
  {
    num: 'MON 09:03',
    label: '3 angles drafted',
    tag: 'DRAFTING',
    accent: '#FF7A5C',
    line: 'Three angles, drafted in your voice.',
    sub: 'From one event it writes three platform-native takes — a contrarian hook, a story, and a tactical thread — each routed through your fingerprint.',
    metric: '3 drafts · avg hook 84',
    big: '2',
  },
  {
    num: 'MON 09:05',
    label: 'Voice QA',
    tag: 'VOICE QA',
    accent: '#5BC8FF',
    line: 'Voice QA sharpens the winner to 94%.',
    sub: 'The strongest draft gets tightened until it reads unmistakably like you — generic-AI risk drops to low, hook score climbs to 87.',
    metric: 'Voice match · 41% → 94%',
    big: '3',
  },
  {
    num: 'MON 09:06',
    label: 'Scheduled',
    tag: 'SCHEDULED',
    accent: '#6EE7B7',
    line: 'Scheduled to LinkedIn + X for peak time.',
    sub: 'One click queues it natively to both platforms at the slots your audience actually shows up — Tuesday 9:20 AM.',
    metric: 'Queued · Tue 9:20 AM',
    big: '4',
  },
  {
    num: 'TUE 14:40',
    label: 'Replies sync',
    tag: 'REPLIES IN',
    accent: '#FF7A5C',
    line: 'Replies sync in — one tagged high-signal.',
    sub: 'A founder asks how you batch it all. Content OS drafts an on-voice reply and flags the thread as worth its own post.',
    metric: '63 replies · 1 high-signal',
    big: '5',
  },
  {
    num: 'NEXT MON',
    label: 'New idea born',
    tag: 'COMPOUNDED',
    accent: '#6EE7B7',
    line: "That reply becomes next week's idea.",
    sub: 'The high-signal question lands back in your Story Bank as a fresh, pre-validated angle — and the loop starts again, sharper.',
    metric: 'Creator Brain · +1 winning pattern',
    big: '6',
  },
];
