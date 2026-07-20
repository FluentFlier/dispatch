import 'server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { updateNotionConnection } from './store';
import { NOTION_MCP_URL, refreshNotionToken, tokenExpiry } from './oauth';
import type { NotionMcpConnectionRow, NotionSelf } from './types';

const USER_AGENT = 'Dispatch-MCP-Client/1.0';

function contentText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => (
      Boolean(block) && typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ))
    .map((block) => block.text)
    .join('\n\n');
}

async function refreshConnection(row: NotionMcpConnectionRow): Promise<{
  row: NotionMcpConnectionRow;
  accessToken: string;
}> {
  if (!row.refresh_token_encrypted) throw new Error('NOTION_REAUTH_REQUIRED');
  const tokens = await refreshNotionToken({
    endpoint: row.oauth_token_endpoint,
    refreshToken: decryptToken(row.refresh_token_encrypted),
    clientId: row.oauth_client_id,
    clientSecret: row.oauth_client_secret_encrypted
      ? decryptToken(row.oauth_client_secret_encrypted)
      : undefined,
  });
  const updated = await updateNotionConnection(row.workspace_id, {
    access_token_encrypted: encryptToken(tokens.access_token),
    refresh_token_encrypted: tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : row.refresh_token_encrypted,
    token_expires_at: tokenExpiry(tokens.expires_in),
  });
  return { row: updated, accessToken: tokens.access_token };
}

async function validAccessToken(row: NotionMcpConnectionRow): Promise<{
  row: NotionMcpConnectionRow;
  accessToken: string;
}> {
  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.POSITIVE_INFINITY;
  if (expiresAt - Date.now() < 120_000) return refreshConnection(row);
  return { row, accessToken: decryptToken(row.access_token_encrypted) };
}

async function createClient(accessToken: string, useSse = false): Promise<Client> {
  const client = new Client({ name: 'dispatch', version: '1.0.0' }, { capabilities: {} });
  const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': USER_AGENT };
  const transport = useSse
    ? new SSEClientTransport(new URL('https://mcp.notion.com/sse'), { requestInit: { headers } })
    : new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), { requestInit: { headers } });
  await client.connect(transport);
  return client;
}

async function connectedClient(row: NotionMcpConnectionRow): Promise<{
  client: Client;
  row: NotionMcpConnectionRow;
}> {
  let credential = await validAccessToken(row);
  try {
    return { client: await createClient(credential.accessToken), row: credential.row };
  } catch (firstError) {
    // A token can be revoked before its advertised expiry. Refresh once before
    // falling back to the legacy SSE transport.
    if (credential.row.refresh_token_encrypted) {
      try {
        credential = await refreshConnection(credential.row);
        return { client: await createClient(credential.accessToken), row: credential.row };
      } catch (refreshError) {
        if (refreshError instanceof Error && refreshError.message === 'NOTION_REAUTH_REQUIRED') throw refreshError;
      }
    }
    try {
      return { client: await createClient(credential.accessToken, true), row: credential.row };
    } catch {
      throw firstError;
    }
  }
}

async function resolveToolName(client: Client, preferred: string, fallback: string): Promise<string> {
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  if (names.has(preferred)) return preferred;
  if (names.has(fallback)) return fallback;
  throw new Error(`Notion MCP tool ${preferred} is unavailable`);
}

export async function getNotionSelf(row: NotionMcpConnectionRow): Promise<NotionSelf> {
  const { client } = await connectedClient(row);
  try {
    const toolName = await resolveToolName(client, 'notion-fetch', 'fetch');
    const result = await client.callTool({ name: toolName, arguments: { id: 'self' } });
    const text = contentText(result);
    const parsed = JSON.parse(text) as { self?: NotionSelf };
    if (!parsed.self?.workspace?.id || !parsed.self.user?.id) {
      throw new Error('Notion MCP returned an invalid workspace identity');
    }
    return parsed.self;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function fetchNotionSources(
  row: NotionMcpConnectionRow,
  sourceUrls: string[],
): Promise<Array<{ sourceUrl: string; content: string }>> {
  const { client } = await connectedClient(row);
  try {
    const toolName = await resolveToolName(client, 'notion-fetch', 'fetch');
    const results: Array<{ sourceUrl: string; content: string }> = [];
    // Deliberately sequential: Notion applies per-user/workspace MCP rate limits.
    for (const sourceUrl of sourceUrls) {
      const result = await client.callTool({ name: toolName, arguments: { id: sourceUrl } });
      const content = contentText(result).trim();
      if (!content) throw new Error(`Notion returned no content for ${sourceUrl}`);
      results.push({ sourceUrl, content });
    }
    return results;
  } finally {
    await client.close().catch(() => undefined);
  }
}
