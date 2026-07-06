export type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';

export interface NurtureProcessResult {
  prepared: number;
  connectsSent: number;
  blocked: number;
  errors: string[];
}
