import { decryptToken, encryptToken } from '@/lib/crypto';

export const NOTION_FLOW_COOKIE = 'dispatch-notion-mcp-oauth';

export interface NotionOAuthFlow {
  state: string;
  verifier: string;
  workspaceId: string;
  userId: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  expiresAt: number;
}

export function encodeNotionFlow(flow: NotionOAuthFlow): string {
  const payload = Buffer.from(JSON.stringify(flow), 'utf8').toString('base64url');
  return encryptToken(payload);
}

export function decodeNotionFlow(raw: string | undefined): NotionOAuthFlow | null {
  if (!raw) return null;
  try {
    const payload = decryptToken(raw);
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as NotionOAuthFlow;
    if (!flow.state || !flow.verifier || !flow.workspaceId || !flow.userId ||
        !flow.redirectUri || !flow.clientId || !flow.tokenEndpoint || flow.expiresAt < Date.now()) {
      return null;
    }
    return flow;
  } catch {
    return null;
  }
}

export function notionAppBaseUrl(requestOrigin: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || requestOrigin).replace(/\/$/, '');
}
