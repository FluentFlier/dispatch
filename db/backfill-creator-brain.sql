-- Backfill creator brain pages from creator_profile + posted posts.
-- Idempotent: safe to re-run. Apply: npx @insforge/cli db import db/backfill-creator-brain.sql -y

-- 1) Provision core stubs for every profile missing them
INSERT INTO creator_brain_pages (user_id, workspace_id, slug, title, tags, body)
SELECT
  cp.user_id,
  w.id,
  s.slug,
  s.title,
  s.tags,
  s.body
FROM creator_profile cp
LEFT JOIN workspaces w ON w.owner_user_id = cp.user_id AND w.type = 'solo'
CROSS JOIN (
  VALUES
    ('voice', 'Voice', ARRAY['voice', 'core']::text[], '{"status":"pending","note":"Complete Voice Lab or onboarding to populate."}'),
    ('profile', 'Profile', ARRAY['profile', 'core']::text[], '{"status":"pending"}'),
    ('wins', 'What works', ARRAY['wins', 'performance']::text[], '{"top_posts":[],"note":"Published posts with strong metrics appear here."}'),
    ('gtm', 'GTM playbook', ARRAY['gtm', 'signals', 'outreach']::text[], '{"status":"pending","icp":"","pitch":"","objections":""}')
) AS s(slug, title, tags, body)
WHERE NOT EXISTS (
  SELECT 1 FROM creator_brain_pages cb
  WHERE cb.user_id = cp.user_id AND cb.slug = s.slug
)
ON CONFLICT (user_id, slug) DO NOTHING;

-- 2) Sync voice page from creator_profile
INSERT INTO creator_brain_pages (user_id, workspace_id, slug, title, tags, body, updated_at)
SELECT
  cp.user_id,
  w.id,
  'voice',
  cp.display_name || ': voice',
  ARRAY['voice', 'core']::text[],
  json_build_object(
    'voice_description', cp.voice_description,
    'voice_rules', cp.voice_rules,
    'synced_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )::text,
  now()
FROM creator_profile cp
LEFT JOIN workspaces w ON w.owner_user_id = cp.user_id AND w.type = 'solo'
ON CONFLICT (user_id, slug) DO UPDATE SET
  workspace_id = COALESCE(EXCLUDED.workspace_id, creator_brain_pages.workspace_id),
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  updated_at = now();

-- 3) Sync profile page from creator_profile
INSERT INTO creator_brain_pages (user_id, workspace_id, slug, title, tags, body, updated_at)
SELECT
  cp.user_id,
  w.id,
  'profile',
  cp.display_name || ': profile',
  ARRAY['profile', 'core']::text[],
  json_build_object(
    'display_name', cp.display_name,
    'bio', cp.bio,
    'bio_facts', cp.bio_facts,
    'content_pillars', COALESCE(cp.content_pillars, '[]'::jsonb),
    'synced_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )::text,
  now()
FROM creator_profile cp
LEFT JOIN workspaces w ON w.owner_user_id = cp.user_id AND w.type = 'solo'
ON CONFLICT (user_id, slug) DO UPDATE SET
  workspace_id = COALESCE(EXCLUDED.workspace_id, creator_brain_pages.workspace_id),
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  updated_at = now();

-- 4) Sync per-post brain pages for published posts
INSERT INTO creator_brain_pages (user_id, workspace_id, slug, title, tags, body, updated_at)
SELECT
  p.user_id,
  p.workspace_id,
  'post/' || p.id::text,
  p.title || ' (' || p.platform || ')',
  ARRAY['published', p.platform, p.pillar]::text[],
  json_build_object(
    'post_id', p.id,
    'platform', p.platform,
    'pillar', p.pillar,
    'content', left(trim(both E'\n' from concat_ws(E'\n\n', nullif(p.hook, ''), nullif(p.script, ''), nullif(p.caption, ''))), 4000),
    'views', p.views,
    'likes', p.likes,
    'posted_date', p.posted_date,
    'synced_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )::text,
  now()
FROM posts p
WHERE p.status = 'posted'
  AND trim(both E'\n' from concat_ws(E'\n\n', nullif(p.hook, ''), nullif(p.script, ''), nullif(p.caption, ''))) <> ''
ON CONFLICT (user_id, slug) DO UPDATE SET
  workspace_id = COALESCE(EXCLUDED.workspace_id, creator_brain_pages.workspace_id),
  title = EXCLUDED.title,
  tags = EXCLUDED.tags,
  body = EXCLUDED.body,
  updated_at = now();

-- 5) Rebuild wins page (top 5 posted by views per user)
WITH ranked AS (
  SELECT
    p.user_id,
    p.workspace_id,
    p.id,
    p.title,
    p.platform,
    p.pillar,
    p.views,
    p.likes,
    left(trim(both ' ' from concat_ws(' ', nullif(p.hook, ''), nullif(p.caption, ''))), 200) AS snippet,
    row_number() OVER (PARTITION BY p.user_id ORDER BY p.views DESC NULLS LAST) AS rn
  FROM posts p
  WHERE p.status = 'posted'
),
wins_agg AS (
  SELECT
    user_id,
    max(workspace_id::text)::uuid AS workspace_id,
    json_agg(
      json_build_object(
        'post_id', id,
        'title', title,
        'platform', platform,
        'pillar', pillar,
        'views', views,
        'likes', likes,
        'snippet', snippet
      )
      ORDER BY views DESC NULLS LAST
    ) AS top_posts
  FROM ranked
  WHERE rn <= 5
  GROUP BY user_id
)
INSERT INTO creator_brain_pages (user_id, workspace_id, slug, title, tags, body, updated_at)
SELECT
  w.user_id,
  w.workspace_id,
  'wins',
  'What works',
  ARRAY['wins', 'performance']::text[],
  json_build_object(
    'top_posts', COALESCE(w.top_posts, '[]'::json),
    'synced_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )::text,
  now()
FROM wins_agg w
ON CONFLICT (user_id, slug) DO UPDATE SET
  workspace_id = COALESCE(EXCLUDED.workspace_id, creator_brain_pages.workspace_id),
  body = EXCLUDED.body,
  updated_at = now();
