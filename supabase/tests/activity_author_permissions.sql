-- Run against a database with an admin and an accessible lead. Never leaves data.
BEGIN;
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p.id)::text, true),
       set_config('test.activity_deal', d.id::text, true),
       set_config('test.activity_org', d.organization_id::text, true)
FROM public.deals d JOIN public.profiles p ON p.organization_id = d.organization_id AND p.role = 'admin'
WHERE d.deleted_at IS NULL LIMIT 1;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  activity record;
  activity_type text;
BEGIN
  FOREACH activity_type IN ARRAY ARRAY['NOTE', 'TASK'] LOOP
    INSERT INTO public.activities(title, type, date, completed, deal_id, organization_id)
    VALUES ('Verification rollback', activity_type, now(), false,
            current_setting('test.activity_deal')::uuid, current_setting('test.activity_org')::uuid)
    RETURNING * INTO activity;
    IF activity.created_by IS DISTINCT FROM auth.uid() OR activity.created_actor_kind <> 'user' THEN
      RAISE EXCEPTION 'Incorrect activity author';
    END IF;
    UPDATE public.activities SET description = 'Edited in rollback test'
    WHERE id = activity.id RETURNING * INTO activity;
    IF activity.edited_by IS DISTINCT FROM auth.uid() OR activity.edited_at IS NULL THEN
      RAISE EXCEPTION 'Incorrect activity editor';
    END IF;
  END LOOP;
  IF has_schema_privilege('authenticated', 'crm_internal', 'USAGE') THEN
    RAISE EXCEPTION 'The private schema must stay private';
  END IF;
END;
$$;
ROLLBACK;
