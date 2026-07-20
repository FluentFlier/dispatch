import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { decodeNotionFlow, notionAppBaseUrl, NOTION_FLOW_COOKIE } from '@/lib/notion/flow';
import { exchangeNotionCode, tokenExpiry } from '@/lib/notion/oauth';
import { getNotionSelf } from '@/lib/notion/mcp';
import { saveNotionConnection, updateNotionConnection } from '@/lib/notion/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

function redirect(baseUrl: string, key: string, value: string): NextResponse {
  const response = NextResponse.redirect(`${baseUrl}/settings?tab=connections&${key}=${value}`);
  response.cookies.delete({ name: NOTION_FLOW_COOKIE, path: '/api/integrations/notion' });
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const baseUrl = notionAppBaseUrl(request.nextUrl.origin);
  const flow = decodeNotionFlow(request.cookies.get(NOTION_FLOW_COOKIE)?.value);
  if (!flow || request.nextUrl.searchParams.get('state') !== flow.state) {
    return redirect(baseUrl, 'notion_error', 'invalid_state');
  }
  if (request.nextUrl.searchParams.get('error')) {
    return redirect(baseUrl, 'notion_error', 'authorization_declined');
  }
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return redirect(baseUrl, 'notion_error', 'missing_code');

  const user = await getAuthenticatedUser();
  if (!user || user.id !== flow.userId) return redirect(baseUrl, 'notion_error', 'wrong_user');
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (workspaceId !== flow.workspaceId) return redirect(baseUrl, 'notion_error', 'wrong_workspace');

  try {
    const tokens = await exchangeNotionCode({
      endpoint: flow.tokenEndpoint,
      code,
      verifier: flow.verifier,
      clientId: flow.clientId,
      clientSecret: flow.clientSecret,
      redirectUri: flow.redirectUri,
    });
    if (!tokens.workspace_id || !tokens.user_id) throw new Error('Notion token response omitted identity');

    let connection = await saveNotionConnection({
      workspace_id: workspaceId,
      connected_by_user_id: user.id,
      notion_workspace_id: tokens.workspace_id,
      notion_workspace_name: null,
      notion_user_id: tokens.user_id,
      notion_user_name: null,
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      token_expires_at: tokenExpiry(tokens.expires_in),
      oauth_client_id: flow.clientId,
      oauth_client_secret_encrypted: flow.clientSecret ? encryptToken(flow.clientSecret) : null,
      oauth_token_endpoint: flow.tokenEndpoint,
    });

    // Label the connection through MCP itself; REST /users/me does not accept
    // MCP-audienced tokens. Failure here should not discard a valid grant.
    try {
      const self = await getNotionSelf(connection);
      connection = await updateNotionConnection(workspaceId, {
        notion_workspace_name: self.workspace.name ?? null,
        notion_user_name: self.user.name ?? null,
      });
    } catch (identityError) {
      console.warn('[notion:mcp] connected but identity lookup failed', identityError);
    }

    // Assert encrypted values can still be decoded before considering setup done.
    decryptToken(connection.access_token_encrypted);
    return redirect(baseUrl, 'notion_connected', 'true');
  } catch (error) {
    console.error('[notion:mcp] callback failed', error);
    return redirect(baseUrl, 'notion_error', 'save_failed');
  }
}
