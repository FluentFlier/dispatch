export type SocialPlatform = 'twitter' | 'linkedin' | 'instagram' | 'threads';

export interface PublishPayload {
  platform: SocialPlatform;
  text: string;
  imageUrl?: string | null;
  scheduledAt?: string | null;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  url?: string;
  error?: string;
  provider: 'ayrshare' | 'direct';
}

export interface ConnectedSocialAccount {
  platform: SocialPlatform;
  accountName: string | null;
  accountId: string | null;
  healthStatus: string;
  provider: 'ayrshare' | 'direct';
}

export interface SocialProvider {
  readonly name: 'ayrshare' | 'direct';
  listAccounts(userId: string): Promise<ConnectedSocialAccount[]>;
  publish(userId: string, payload: PublishPayload): Promise<PublishResult>;
  getConnectUrl?(userId: string, platform?: SocialPlatform): Promise<string | null>;
}
