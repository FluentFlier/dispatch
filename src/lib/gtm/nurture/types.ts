export type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';

export interface NurtureProcessResult {
  prepared: number;
  commentsAdvanced: number;
  connectsSent: number;
  dmsPrepared: number;
  dmsSent: number;
  blocked: number;
  errors: string[];
}
