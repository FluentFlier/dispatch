create table if not exists public.notion_mcp_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connected_by_user_id uuid not null references auth.users(id) on delete cascade,
  notion_workspace_id text not null,
  notion_workspace_name text,
  notion_user_id text,
  notion_user_name text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  oauth_client_id text not null,
  oauth_client_secret_encrypted text,
  oauth_token_endpoint text not null,
  source_urls text[] not null default '{}',
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index if not exists notion_mcp_connections_user_idx
  on public.notion_mcp_connections (connected_by_user_id);

alter table public.notion_mcp_connections enable row level security;
alter table public.notion_mcp_connections force row level security;

revoke all on public.notion_mcp_connections from anon, authenticated;
grant all on public.notion_mcp_connections to project_admin;

drop policy if exists notion_mcp_connections_project_admin on public.notion_mcp_connections;
create policy notion_mcp_connections_project_admin
  on public.notion_mcp_connections
  for all
  to project_admin
  using (true)
  with check (true);

drop trigger if exists notion_mcp_connections_updated_at on public.notion_mcp_connections;
create trigger notion_mcp_connections_updated_at
  before update on public.notion_mcp_connections
  for each row execute function system.update_updated_at();
