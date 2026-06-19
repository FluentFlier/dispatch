-- RLS for the two new tenancy tables. Safe to apply immediately: no existing
-- code reads/writes these tables, and the new workspace lib satisfies every
-- policy (a user only ever inserts their own membership and owns the workspaces
-- they create). This closes the cross-tenant membership-visibility gap ahead of
-- the full PART 2 RLS rewrite.

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;

-- workspace_members: a user sees and manages only their own membership rows.
DROP POLICY IF EXISTS wm_select ON workspace_members;
CREATE POLICY wm_select ON workspace_members FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS wm_insert ON workspace_members;
CREATE POLICY wm_insert ON workspace_members FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS wm_delete ON workspace_members;
CREATE POLICY wm_delete ON workspace_members FOR DELETE USING (user_id = auth.uid());

-- workspaces: visible to members; mutated only by the owner.
DROP POLICY IF EXISTS ws_select ON workspaces;
CREATE POLICY ws_select ON workspaces FOR SELECT USING (
  id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS ws_insert ON workspaces;
CREATE POLICY ws_insert ON workspaces FOR INSERT WITH CHECK (owner_user_id = auth.uid());
DROP POLICY IF EXISTS ws_update ON workspaces;
CREATE POLICY ws_update ON workspaces FOR UPDATE USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS ws_delete ON workspaces;
CREATE POLICY ws_delete ON workspaces FOR DELETE USING (owner_user_id = auth.uid());

-- service-role (project_admin) bypass, matching the convention on other tables.
DROP POLICY IF EXISTS ws_admin ON workspaces;
CREATE POLICY ws_admin ON workspaces FOR ALL TO project_admin USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS wm_admin ON workspace_members;
CREATE POLICY wm_admin ON workspace_members FOR ALL TO project_admin USING (true) WITH CHECK (true);
