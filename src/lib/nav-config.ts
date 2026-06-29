/** Everyday creator IA — core loop in primary nav; power tools in More. */

export const primaryNav = [
  { name: 'Home', href: '/dashboard', short: 'Home' },
  { name: 'Write', href: '/generate', short: 'Write' },
  { name: 'Posts', href: '/library', short: 'Posts' },
  { name: 'Signals', href: '/signals', short: 'Signals' },
] as const;

/** Mobile bottom bar: 4 taps + More (avoids 7-icon crowding). */
export const bottomBarNav = [
  { name: 'Home', href: '/dashboard', short: 'Home' },
  { name: 'Write', href: '/generate', short: 'Write' },
  { name: 'Posts', href: '/library', short: 'Posts' },
  { name: 'Signals', href: '/signals', short: 'Signals' },
] as const;

export const moreNav = [
  { name: 'Schedule', href: '/calendar' },
  { name: 'Comments', href: '/inbox' },
  { name: 'Settings', href: '/settings' },
  { name: 'Ideas', href: '/ideas' },
  { name: 'Stats', href: '/analytics' },
  { name: 'Refine voice', href: '/voice-lab' },
  { name: 'Story bank', href: '/story-bank' },
  { name: 'Series', href: '/series' },
  { name: 'Video studio', href: '/video-studio' },
] as const;
