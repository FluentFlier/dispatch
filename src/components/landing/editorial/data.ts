/**
 * Copy for the Loop accordion and Week timeline.
 */

export interface LoopStep {
  num: string;
  label: string;
  accent: string;
  mark: string;
  lede: string;
  exLabel: string;
  ex: string;
}

export const LOOP_STEPS: LoopStep[] = [
  {
    num: '01',
    label: 'Signal',
    accent: '#2563EB',
    mark: 'CAPTURE',
    lede: 'Calendar, notes, comments → Story Bank.',
    exLabel: 'INCOMING',
    ex: 'Podcast tomorrow · 4pm',
  },
  {
    num: '02',
    label: 'Draft',
    accent: '#E8543A',
    mark: 'GENERATE',
    lede: 'Native posts in your voice. Scored before you see them.',
    exLabel: 'DRAFTED',
    ex: '“I built a system instead.”',
  },
  {
    num: '03',
    label: 'Publish',
    accent: '#0F766E',
    mark: 'SCHEDULE',
    lede: 'One calendar. LinkedIn and X.',
    exLabel: 'QUEUED',
    ex: 'LinkedIn + X · Tue 9:20',
  },
  {
    num: '04',
    label: 'Reply',
    accent: '#E8543A',
    mark: 'ENGAGE',
    lede: 'Comments in one inbox. Replies in your tone.',
    exLabel: 'HIGH-SIGNAL',
    ex: '@founder: “how do you batch this?”',
  },
  {
    num: '05',
    label: 'Learn',
    accent: '#2563EB',
    mark: 'COMPOUND',
    lede: 'Wins feed Creator Brain. Next week starts sharper.',
    exLabel: 'FED BACK',
    ex: 'Hook +18% vs average',
  },
];

export interface WalkStep {
  num: string;
  label: string;
  tag: string;
  accent: string;
  line: string;
  metric: string;
  big: string;
}

export const WALK_STEPS: WalkStep[] = [
  {
    num: 'MON 09:02',
    label: 'Signal',
    tag: 'SIGNAL',
    accent: '#5BC8FF',
    line: 'Calendar event → content angle.',
    metric: 'Podcast detected',
    big: '1',
  },
  {
    num: 'MON 09:03',
    label: '3 drafts',
    tag: 'DRAFT',
    accent: '#FF7A5C',
    line: 'Three takes in your voice.',
    metric: '3 drafts · hook 84',
    big: '2',
  },
  {
    num: 'MON 09:05',
    label: 'Voice QA',
    tag: 'VOICE',
    accent: '#5BC8FF',
    line: 'Winner tightened to 94%.',
    metric: 'Voice · 94%',
    big: '3',
  },
  {
    num: 'MON 09:06',
    label: 'Scheduled',
    tag: 'QUEUE',
    accent: '#6EE7B7',
    line: 'LinkedIn + X queued.',
    metric: 'Tue 9:20 AM',
    big: '4',
  },
  {
    num: 'TUE 14:40',
    label: 'Replies',
    tag: 'INBOX',
    accent: '#FF7A5C',
    line: 'One thread flagged high-signal.',
    metric: '63 replies · 1 flagged',
    big: '5',
  },
  {
    num: 'NEXT MON',
    label: 'Compounds',
    tag: 'LEARN',
    accent: '#6EE7B7',
    line: 'Reply → next week\'s idea.',
    metric: 'Brain +1 pattern',
    big: '6',
  },
];
