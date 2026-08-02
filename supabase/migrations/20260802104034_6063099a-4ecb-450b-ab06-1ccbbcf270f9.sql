CREATE TABLE public.invited_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  approved boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX invited_clients_email_key ON public.invited_clients (lower(email));

GRANT ALL ON public.invited_clients TO service_role;

ALTER TABLE public.invited_clients ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_invited_clients_updated_at
BEFORE UPDATE ON public.invited_clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A signed-in user counts as an approved client only when their email is
-- confirmed and appears on the invite list with approval enabled.
CREATE OR REPLACE FUNCTION public.is_approved_client(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.invited_clients i ON lower(i.email) = lower(u.email)
    WHERE u.id = _user_id
      AND u.email_confirmed_at IS NOT NULL
      AND i.approved
  );
$$;

REVOKE ALL ON FUNCTION public.is_approved_client(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_approved_client(uuid) TO authenticated, service_role;

DROP TABLE IF EXISTS public.event_access;

INSERT INTO public.invited_clients (email, approved, note)
VALUES ('client@sideline.test', true, 'Example invited client');