-- Preview derivative storage buckets served by the site.
--   public-previews  : watermarked previews, world-readable (served directly as public URLs).
--   private-previews : clean (un-watermarked) previews, service-role only. The app mints
--                      short-lived signed URLs at read time for approved clients.
--
-- The VPS ingest worker writes both buckets with the service-role key; browsers only ever
-- read public-previews directly. Idempotent so it is safe to (re)apply.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('public-previews', 'public-previews', true),
  ('private-previews', 'private-previews', false)
ON CONFLICT (id) DO NOTHING;

-- storage.objects has RLS enabled by default on Supabase. Define explicit policies.

-- public-previews: anon + authenticated may read; service_role may do anything.
DROP POLICY IF EXISTS "public-previews read" ON storage.objects;
CREATE POLICY "public-previews read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'public-previews');

DROP POLICY IF EXISTS "public-previews service_role all" ON storage.objects;
CREATE POLICY "public-previews service_role all"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'public-previews')
  WITH CHECK (bucket_id = 'public-previews');

-- private-previews: no anon/authenticated access at all; service_role only.
DROP POLICY IF EXISTS "private-previews service_role all" ON storage.objects;
CREATE POLICY "private-previews service_role all"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'private-previews')
  WITH CHECK (bucket_id = 'private-previews');

-- Idempotency support for the ingest worker's upserts:
--   photos are keyed on their HiDrive master path (one row per master),
--   athletes are de-duplicated case-insensitively by full name.
CREATE UNIQUE INDEX IF NOT EXISTS photos_hidrive_original_path_key
  ON public.photos (hidrive_original_path);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_full_name_key
  ON public.athletes (lower(full_name));
