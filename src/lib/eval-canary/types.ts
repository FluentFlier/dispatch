/** Canary case shapes shared by the generator, the promptfoo config, and the cron runner. */
export interface CanaryFixture {
  profile: unknown;
  vocabulary?: unknown;
  structural?: unknown;
}

export interface CanaryCaseVars {
  userPrompt: string;
  platform?: string;
  contentType?: string;
  useVoice?: boolean;
  sourceContext?: string;
  mentions?: string[];
  profileFixture?: string;
  inlineFixture?: CanaryFixture;
}

export interface CanaryCase {
  id: string;
  description: string;
  vars: CanaryCaseVars;
}
