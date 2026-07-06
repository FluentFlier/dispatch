export type NurtureStage =
  | 'discovered'
  | 'planned'
  | 'engaging'
  | 'connect_ready'
  | 'connect_sent'
  | 'nurturing'
  | 'dm_ready'
  | 'dm_sent'
  | 'replied'
  | 'closed';

export type PlaybookStepType = 'research' | 'comment' | 'connect' | 'dm';

export interface PlaybookStep {
  type: PlaybookStepType;
  label: string;
  dueInDays: number;
  status: 'pending' | 'done' | 'skipped';
}

export interface LeadPlaybook {
  whyThem: string;
  angle: string;
  steps: PlaybookStep[];
  hookContext?: string;
  generatedAt: string;
}

export interface NurtureProcessResult {
  prepared: number;
  connectsSent: number;
  blocked: number;
  errors: string[];
}
