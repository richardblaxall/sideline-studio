REVOKE ALL ON FUNCTION public.is_approved_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_client(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_approved_client(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_client(uuid) TO service_role;