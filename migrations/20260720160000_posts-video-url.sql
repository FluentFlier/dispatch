-- Capture a post's video.
--
-- WHY: the importer only ever read attachments of type 'img', so a post whose
-- media was a video came in as bare text - no sign it had any media at all.
-- A LinkedIn post carries either one video or a set of images, never both, so
-- one url covers it; the image set already lives in posts.images.

alter table posts
  add column if not exists video_url text;

comment on column posts.video_url is
  'Video attachment URL for a post whose media is a video. Images live in posts.images.';
