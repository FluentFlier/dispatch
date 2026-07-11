/**
 * Navigation IA — ordered by the creator daily loop (gstack review Jul 2026):
 * Home → Write → Posts → Schedule → Inbox (engage) → Leads (convert).
 *
 * Hidden routes stay reachable by URL but are omitted from chrome when `hidden: true`
 * (e.g. Video studio — API stubs until pipeline ships).
 */

export interface NavItem {
  name: string;
  href: string;
  /** Mobile bottom-bar label */
  short: string;
  /** Omit from sidebar / bottom bar */
  hidden?: boolean;
  /** primary = daily loop; more = secondary tools */
  section: 'primary' | 'more';
}

export const navItems: NavItem[] = [
  // --- Primary: daily loop ---
  { name: 'Home', href: '/dashboard', short: 'Home', section: 'primary' },
  { name: 'Write', href: '/generate', short: 'Write', section: 'primary' },
  { name: 'Posts', href: '/library', short: 'Posts', section: 'primary' },
  { name: 'Schedule', href: '/calendar', short: 'Plan', section: 'primary' },
  { name: 'Inbox', href: '/inbox', short: 'Inbox', section: 'primary' },
  { name: 'Leads', href: '/leads', short: 'Leads', section: 'primary' },

  // --- More: power tools (working features only) ---
  { name: 'Creator brain', href: '/brain', short: 'Brain', section: 'more' },
  { name: 'Ideas', href: '/ideas', short: 'Ideas', section: 'more' },
  { name: 'Story bank', href: '/story-bank', short: 'Stories', section: 'more' },
  { name: 'Series', href: '/series', short: 'Series', section: 'more' },
  { name: 'Your voice', href: '/voice-lab', short: 'Voice', section: 'more' },
  { name: 'Event capture', href: '/event-capture', short: 'Events', section: 'more' },
  { name: 'Analytics', href: '/analytics', short: 'Stats', section: 'more' },
  { name: 'Settings', href: '/settings', short: 'Settings', section: 'more' },

  // --- Hidden until feature-complete ---
  {
    name: 'Video studio',
    href: '/video-studio',
    short: 'Video',
    section: 'more',
    hidden: true,
  },
];

/** Visible primary nav entries (sidebar + mobile bottom bar). */
export const primaryNav = navItems.filter((item) => item.section === 'primary' && !item.hidden);

/** Visible secondary nav entries (sidebar "More" + mobile sheet). */
export const moreNav = navItems.filter((item) => item.section === 'more' && !item.hidden);
