import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildNotionAuthorizationUrl, createPkce } from '@/lib/notion/oauth';
import { decodeNotionFlow, encodeNotionFlow, type NotionOAuthFlow } from '@/lib/notion/flow';

afterEach(() => vi.unstubAllEnvs());

describe('Notion MCP OAuth', () => {
  it('builds an authorization-code URL with PKCE and state', () => {
    const pkce = createPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).not.toBe(pkce.verifier);

    const raw = buildNotionAuthorizationUrl({
      metadata: {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      },
      clientId: 'dispatch-client',
      redirectUri: 'https://dispatch.example.com/api/integrations/notion/callback',
      challenge: pkce.challenge,
      state: 'csrf-state',
    });
    const url = new URL(raw);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge);
    expect(url.searchParams.get('state')).toBe('csrf-state');
  });

  it('encrypts and authenticates the short-lived OAuth flow cookie', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '11'.repeat(32));
    const flow: NotionOAuthFlow = {
      state: 'state', verifier: 'verifier', workspaceId: 'workspace', userId: 'user',
      redirectUri: 'https://dispatch.example.com/api/integrations/notion/callback',
      clientId: 'client', tokenEndpoint: 'https://auth.example.com/token',
      expiresAt: Date.now() + 60_000,
    };
    const encoded = encodeNotionFlow(flow);
    expect(encoded).not.toContain('verifier');
    expect(decodeNotionFlow(encoded)).toEqual(flow);
    const parts = encoded.split(':');
    parts[1] = `${parts[1].slice(0, 2)}${parts[1][2] === 'A' ? 'B' : 'A'}${parts[1].slice(3)}`;
    expect(decodeNotionFlow(parts.join(':'))).toBeNull();
  });
});

describe('Notion MCP integration wiring', () => {
  const root = process.cwd();

  it('keeps MCP credentials in a server-only table', () => {
    const migration = readFileSync(join(root, 'migrations/20260719120000_add-notion-mcp-connections.sql'), 'utf8');
    expect(migration).toContain('access_token_encrypted text not null');
    expect(migration).toContain('refresh_token_encrypted text');
    expect(migration).toContain('revoke all on public.notion_mcp_connections from anon, authenticated');
    expect(migration).toContain('unique (workspace_id)');
  });

  it('writes fetched Notion content into workspace-scoped Brain pages', () => {
    const route = readFileSync(join(root, 'src/app/api/integrations/notion/sync/route.ts'), 'utf8');
    expect(route).toContain("tags: ['notion', 'imported', 'context']");
    expect(route).toContain('workspaceId,');
    expect(route).toContain('fetchNotionSources(connection, sourceUrls)');
  });
});
