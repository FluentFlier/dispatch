-- Multi-image support for imported posts.
--
-- posts.image_url only ever stored the FIRST image from a Unipile import
-- (firstImageUrl() in persist-imported-posts.ts discarded the rest). This adds
-- an `images` jsonb array holding every image plus a cached vision-model
-- description per image, so generation can actually use what was in the photo
-- instead of just knowing one existed.
--
-- Shape: [{ "url": "https://...", "description": "..." }, ...]
-- image_url is left untouched (still the first image, for existing UI reads).
--
-- Safe to run multiple times.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
