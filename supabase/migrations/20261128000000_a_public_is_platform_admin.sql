-- The booking export needs to distinguish platform admins (may download any
-- evaluator's bookings and the full ZIP) from a staff user who is themselves an
-- evaluator (only their own bookings). Expose the existing guard as a boolean
-- RPC; it reveals no data beyond the caller's own admin status.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.is_platform_admin() $$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
