export interface NotionMcpConnectionRow {
  id: string;
  workspace_id: string;
  connected_by_user_id: string;
  notion_workspace_id: string;
  notion_workspace_name: string | null;
  notion_user_id: string | null;
  notion_user_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  oauth_client_id: string;
  oauth_client_secret_encrypted: string | null;
  oauth_token_endpoint: string;
  source_urls: string[];
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotionOAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
}

export interface NotionTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  user_id?: string;
  workspace_id?: string;
  email_domain?: string;
}

export interface NotionSelf {
  workspace: { id: string; name?: string };
  user: { id: string; name?: string; email?: string; type?: string };
  current_tool_access?: Record<string, { status: string; upgrade_url?: string }>;
}
