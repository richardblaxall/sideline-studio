-- public-previews: world-readable
DROP POLICY IF EXISTS "public previews are readable by anyone" ON storage.objects;
CREATE POLICY "public previews are readable by anyone"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'public-previews');

-- public-previews: writes are service_role only
DROP POLICY IF EXISTS "service role manages public previews" ON storage.objects;
CREATE POLICY "service role manages public previews"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'public-previews')
  WITH CHECK (bucket_id = 'public-previews');

-- private-previews: service_role only, no anon/authenticated policy at all
DROP POLICY IF EXISTS "service role manages private previews" ON storage.objects;
CREATE POLICY "service role manages private previews"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'private-previews')
  WITH CHECK (bucket_id = 'private-previews');