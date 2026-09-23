-- Only the deal INSERT trigger invokes this function; never expose it as an RPC.
ALTER FUNCTION public.assign_deal_owner() SET search_path = '';
REVOKE ALL ON FUNCTION public.assign_deal_owner() FROM PUBLIC, anon, authenticated;
