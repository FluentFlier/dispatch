/** Simplified navigation for everyday creators (plain labels). */

export const primaryNav = [
  { name: 'Home', href: '/dashboard', short: 'Home' },
  { name: 'Write', href: '/generate', short: 'Write' },
  { name: 'Posts', href: '/library', short: 'Posts' },
  { name: 'Schedule', href: '/calendar', short: 'Plan' },
  { name: 'Comments', href: '/inbox', short: 'Reply' },
] as const;

export const moreNav = [
  { name: 'Leads', href: '/leads' },
  { name: 'Event capture', href: '/event-capture' },
  { name: 'Ideas', href: '/ideas' },
  { name: 'Series', href: '/series' },
  { name: 'Story bank', href: '/story-bank' },
  { name: 'Video studio', href: '/video-studio' },
  { name: 'Your voice', href: '/voice-lab' },
  { name: 'Analytics', href: '/analytics' },
  { name: 'Settings', href: '/settings' },
] as const;
