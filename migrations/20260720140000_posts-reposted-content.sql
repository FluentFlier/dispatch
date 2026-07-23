-- Keep the post a repost was built on.
--
-- WHY: importing a repost stored only the creator's commentary. On its own that
-- is text with no subject - "huge congratulations to X for pulling this off"
-- with no sign of what was pulled off. Unipile hands the original back as
-- `repost_content` ({ id, date, parsed_datetime, text, author }); this is where
-- it lands, so the preview can quote it the way LinkedIn does.
--
-- jsonb rather than five columns: the shape is the provider's, we do not query
-- inside it, and it costs one migration instead of one per field they add.

alter table posts
  add column if not exists reposted_content jsonb;

comment on column posts.reposted_content is
  'Unipile repost_content for an imported repost: the original post text + author. Null for original posts.';
