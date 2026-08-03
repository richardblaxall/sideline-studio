REVOKE ALL ON FUNCTION public.sync_event_photo_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_photo_count() TO service_role;