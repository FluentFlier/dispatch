-- Analytics metrics sync writes posts via the service-role client.
-- posts previously only had auth.uid()-scoped policies (no project_admin bypass),
-- so service-role UPDATEs matched 0 rows and analytics stayed blank.
-- Mirrors social_accounts_project_admin / post_comments_project_admin.

DO $$ BEGIN
  CREATE POLICY posts_project_admin ON posts
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY publish_jobs_project_admin ON publish_jobs
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
