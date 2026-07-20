import { createHash, randomBytes } from 'crypto';
import type { NotionOAuthMetadata, NotionTokenResponse } from './types';

export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  return {
    verifier,
    challenge: base64Url(createHash('sha256').update(verifier).digest()),
  };
}

export async function discoverNotionOAuth(): Promise<NotionOAuthMetadata> {
  const protectedUrl = new URL('/.well-known/oauth-protected-resource', NOTION_MCP_URL);
  const protectedResponse = await fetch(protectedUrl, { cache: 'no-store' });
  if (!protectedResponse.ok) throw new Error(`Notion MCP discovery failed (${protectedResponse.status})`);

  const resource = (await protectedResponse.json()) as { authorization_servers?: string[] };
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new Error('Notion MCP did not advertise an authorization server');

  const metadataUrl = new URL('/.well-known/oauth-authorization-server', issuer);
  const response = await fetch(metadataUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Notion OAuth discovery failed (${response.status})`);
  const metadata = (await response.json()) as NotionOAuthMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('Notion OAuth metadata is incomplete');
  }
  return metadata;
}

export async function registerNotionClient(metadata: NotionOAuthMetadata, redirectUri: string) {
  if (!metadata.registration_endpoint) throw new Error('Notion MCP does not support client registration');
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Dispatch',
      client_uri: new URL(redirectUri).origin,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) throw new Error(`Notion client registration failed (${response.status})`);
  return (await response.json()) as { client_id: string; client_secret?: string };
}

export function buildNotionAuthorizationUrl(input: {
  metadata: NotionOAuthMetadata;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  }).toString();
  return url.toString();
}

async function tokenRequest(endpoint: string, params: URLSearchParams): Promise<NotionTokenResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'Dispatch-MCP-Client/1.0',
    },
    body: params.toString(),
  });
  const raw = await response.text();
  if (!response.ok) {
    let code = '';
    try {
      code = (JSON.parse(raw) as { error?: string }).error ?? '';
    } catch {
      // Some gateways return HTML/plain-text failures.
    }
    if (code === 'invalid_grant') throw new Error('NOTION_REAUTH_REQUIRED');
    throw new Error(`Notion token request failed (${response.status})`);
  }
  const tokens = JSON.parse(raw) as NotionTokenResponse;
  if (!tokens.access_token) throw new Error('Notion did not return an access token');
  return tokens;
}

export function exchangeNotionCode(input: {
  endpoint: string;
  code: string;
  verifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}): Promise<NotionTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code', code: input.code, code_verifier: input.verifier,
    client_id: input.clientId, redirect_uri: input.redirectUri,
  });
  if (input.clientSecret) params.set('client_secret', input.clientSecret);
  return tokenRequest(input.endpoint, params);
}

export function refreshNotionToken(input: {
  endpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<NotionTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: input.clientId,
  });
  if (input.clientSecret) params.set('client_secret', input.clientSecret);
  return tokenRequest(input.endpoint, params);
}

export function tokenExpiry(expiresIn?: number): string | null {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
}
