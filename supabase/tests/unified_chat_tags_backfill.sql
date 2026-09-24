-- psql-only, BEFORE the migration is installed. Production data is never committed.
-- Run from any cwd: psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/unified_chat_tags_backfill.sql
-- The controller also exercised this scenario directly on staging before first apply.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.tags'::regclass AND relkind='r') THEN
   RAISE EXCEPTION 'Backfill fixture requires the original public.tags table (pre-migration database)';
 END IF;
END $$;
CREATE TEMP TABLE migration_labels_fixture AS
SELECT '428e1830-2ff5-425a-b9b1-f9379897c2c6'::uuid org,
 gen_random_uuid() legacy_id,gen_random_uuid() chat_id,
 'backfill-'||gen_random_uuid()::text||repeat('long',15) name;
INSERT INTO public.tags(id,organization_id,name,color)
SELECT legacy_id,org,' '||name||' ','bg-red-500' FROM migration_labels_fixture;
INSERT INTO public.tags(organization_id,name,color)
SELECT org,upper(name),'bg-blue-500' FROM migration_labels_fixture;
INSERT INTO public.wa_labels(id,organization_id,name,color)
SELECT chat_id,org,'existing-'||substring(name,1,20),'green' FROM migration_labels_fixture;
INSERT INTO public.tags(organization_id,name,color)
SELECT org,upper('existing-'||substring(name,1,20)),'bg-purple-500' FROM migration_labels_fixture;
\ir ../migrations/20260924010603_unified_chat_tags.sql
\ir ../migrations/20260924010603_unified_chat_tags.sql
DO $$ DECLARE f record;
BEGIN
 SELECT * INTO f FROM migration_labels_fixture;
 IF (SELECT count(*) FROM public.wa_labels WHERE organization_id=f.org AND name_key=lower(f.name))<>1 THEN RAISE EXCEPTION 'Case/trim merge lost or duplicated label'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wa_labels WHERE id=f.chat_id AND color='green') THEN RAISE EXCEPTION 'Existing chat ID/color lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_internal.legacy_tags WHERE id=f.legacy_id AND color='bg-red-500') THEN RAISE EXCEPTION 'Original legacy ID/color not archived'; END IF;
 RAISE NOTICE 'PASS: long names, normalized duplicates, preserved chat ID/color, archived legacy IDs, migration rerun';
END $$;
ROLLBACK;
