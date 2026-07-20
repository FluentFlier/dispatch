import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { ensureActiveWorkspaceId } from '@/lib/workspace';
import {
  buildNotionAuthorizationUrl,
  createPkce,
  discoverNotionOAuth,
  registerNotionClient,
} from '@/lib/notion/oauth';
import { encodeNotionFlow, notionAppBaseUrl, NOTION_FLOW_COOKIE } from '@/lib/notion/flow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const workspaceId = await ensureActiveWorkspaceId(user.id);
  const baseUrl = notionAppBaseUrl(request.nextUrl.origin);
  const redirectUri = `${baseUrl}/api/integrations/notion/callback`;

  try {
    const metadata = await discoverNotionOAuth();
    const registration = await registerNotionClient(metadata, redirectUri);
    const { verifier, challenge } = createPkce();
    const state = randomBytes(32).toString('base64url');
    const authorizationUrl = buildNotionAuthorizationUrl({
      metadata, clientId: registration.client_id, redirectUri, challenge, state,
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(NOTION_FLOW_COOKIE, encodeNotionFlow({
      state,
      verifier,
      workspaceId,
      userId: user.id,
      redirectUri,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      tokenEndpoint: metadata.token_endpoint,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }), {
      httpOnly: true,
      secure: baseUrl.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/integrations/notion',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error('[notion:mcp] connect failed', error);
    return NextResponse.redirect(`${baseUrl}/settings?tab=connections&notion_error=connect_failed`);
  }
}
