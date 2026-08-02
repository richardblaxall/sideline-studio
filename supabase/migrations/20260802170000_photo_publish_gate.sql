-- Private review gate: an ingested photo lands hidden and only appears in the public gallery
-- once it is explicitly published. This lets a new photo be pushed through the (published) app,
-- inspected privately (watermark + parsed metadata), and only then made publicly visible.
--
-- The ingest itself still marks ingest_status='done' (so the poller/idempotency dedupe keeps
-- working); is_published is a separate visibility flag the public gallery filters on.

ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

-- Keep any photos that are already ingested visible (don't hide existing/demo content).
UPDATE public.photos SET is_published = true WHERE ingest_status = 'done';

-- The public gallery filters on is_published; Postgres requires column-level SELECT privilege
-- to reference it in a WHERE clause, so extend the anon/authenticated grant to the new column.
GRANT SELECT (is_published) ON public.photos TO anon, authenticated;

-- Keep events.photo_count in sync with the number of PUBLISHED photos, on both ingest and the
-- moment a photo is published/unpublished. Mirrors the existing update_updated_at_column trigger
-- idiom. SECURITY DEFINER + a pinned search_path so it runs regardless of the writer's role.
CREATE OR REPLACE FUNCTION public.recount_event_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected uuid;
  ids uuid[];
BEGIN
  -- Recount every event touched by this change (event_id can move between rows on UPDATE).
  -- Only reference NEW/OLD for the operations where they exist.
  IF TG_OP = 'DELETE' THEN
    ids := ARRAY[OLD.event_id];
  ELSIF TG_OP = 'INSERT' THEN
    ids := ARRAY[NEW.event_id];
  ELSE
    ids := ARRAY[NEW.event_id, OLD.event_id];
  END IF;

  FOREACH affected IN ARRAY ids LOOP
    IF affected IS NULL THEN CONTINUE; END IF;
    UPDATE public.events
    SET photo_count = (
      SELECT count(*) FROM public.photos
      WHERE event_id = affected AND is_published = true
    )
    WHERE id = affected;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER photos_recount_event_photos
AFTER INSERT OR UPDATE OR DELETE ON public.photos
FOR EACH ROW EXECUTE FUNCTION public.recount_event_photos();

-- One-time reconcile so existing counts reflect published photos.
UPDATE public.events e
SET photo_count = (
  SELECT count(*) FROM public.photos p
  WHERE p.event_id = e.id AND p.is_published = true
);
