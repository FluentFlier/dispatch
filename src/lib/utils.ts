import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, startOfWeek } from 'date-fns';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '--';
  return format(new Date(date), 'MMM d, yyyy');
}

export function formatDateShort(date: string | Date | null): string {
  if (!date) return '--';
  return format(new Date(date), 'MMM d');
}

/** Feed-style age: 31m, 5h, 2d, 3mo, 1y - how LinkedIn and X stamp a comment. */
export function shortAge(date: string | Date): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}

export function formatRelative(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function getWeekStart(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

type StatusType = 'idea' | 'scripted' | 'filmed' | 'edited' | 'posted';

export function nextStatus(current: StatusType): StatusType {
  const pipeline = ['idea', 'scripted', 'filmed', 'edited', 'posted'] as const;
  const idx = pipeline.indexOf(current as typeof pipeline[number]);
  if (idx === pipeline.length - 1) return current;
  return pipeline[idx + 1] as StatusType;
}
