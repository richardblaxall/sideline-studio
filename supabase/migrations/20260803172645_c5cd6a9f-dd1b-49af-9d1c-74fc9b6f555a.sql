ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

GRANT SELECT (id, event_id, public_watermarked_url, headline, caption, date_taken, width, height, exif_data, ingest_status, processed_at, created_at, is_published) ON public.photos TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_event_photo_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ids uuid[];
BEGIN
  ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[NEW.event_id, OLD.event_id]) AS x WHERE x IS NOT NULL);
  UPDATE public.events e
  SET photo_count = (
    SELECT count(*) FROM public.photos p WHERE p.event_id = e.id AND p.is_published
  )
  WHERE e.id = ANY(ids);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS photos_sync_event_photo_count ON public.photos;
CREATE TRIGGER photos_sync_event_photo_count
AFTER INSERT OR UPDATE OF is_published, event_id OR DELETE ON public.photos
FOR EACH ROW EXECUTE FUNCTION public.sync_event_photo_count();

UPDATE public.photos SET is_published = true;

UPDATE public.events e
SET photo_count = (
  SELECT count(*) FROM public.photos p WHERE p.event_id = e.id AND p.is_published
);