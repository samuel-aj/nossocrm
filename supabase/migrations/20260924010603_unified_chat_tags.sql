-- One catalog, preserving chat IDs and legacy string arrays. No contact-wide propagation.
CREATE SCHEMA IF NOT EXISTS crm_internal;
REVOKE ALL ON SCHEMA crm_internal FROM PUBLIC;
CREATE TABLE IF NOT EXISTS crm_internal.retired_label_names (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name_key text NOT NULL,
  PRIMARY KEY (organization_id, name_key)
);
ALTER TABLE crm_internal.retired_label_names ENABLE ROW LEVEL SECURITY;

-- Legacy names may exceed the old chat UI limit. Never truncate migrated data.
ALTER TABLE public.wa_labels DROP CONSTRAINT IF EXISTS wa_labels_name_check;
ALTER TABLE public.wa_labels ADD CONSTRAINT wa_labels_name_check CHECK (btrim(name) <> '');
ALTER TABLE public.wa_labels ADD COLUMN IF NOT EXISTS name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS wa_labels_org_key ON public.wa_labels(organization_id,name_key);

CREATE OR REPLACE FUNCTION crm_internal.label_color(c text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN c ~ '(blue|sky)' THEN 'blue' WHEN c ~ '(green|emerald)' THEN 'green'
 WHEN c ~ '(yellow|amber)' THEN 'yellow' WHEN c ~ 'orange' THEN 'orange'
 WHEN c ~ '(red|rose)' THEN 'red' WHEN c ~ 'pink' THEN 'pink'
 WHEN c ~ '(purple|violet)' THEN 'purple' WHEN c ~ 'teal' THEN 'teal'
 ELSE 'slate' END
$$;

-- Keep a private, read-only archive to preserve legacy IDs/colors for audit/recovery.
-- Rerunning this migration sees the compatibility view and does not archive it again.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.tags'::regclass AND relkind='r') THEN
   INSERT INTO public.wa_labels(id,organization_id,name,color,created_at)
   SELECT DISTINCT ON (organization_id,lower(btrim(name))) id,organization_id,btrim(name),
          crm_internal.label_color(color),coalesce(created_at,now())
   FROM public.tags WHERE organization_id IS NOT NULL AND btrim(name)<>''
   ORDER BY organization_id,lower(btrim(name)),created_at,id
   ON CONFLICT (organization_id,name_key) DO NOTHING;
   ALTER TABLE public.tags SET SCHEMA crm_internal;
   ALTER TABLE crm_internal.tags RENAME TO legacy_tags;
   REVOKE ALL ON crm_internal.legacy_tags FROM PUBLIC,anon,authenticated,service_role;
 END IF;
END $$;

INSERT INTO public.wa_labels(organization_id,name)
SELECT DISTINCT ON (d.organization_id,lower(btrim(t.name))) d.organization_id,btrim(t.name)
FROM public.deals d CROSS JOIN LATERAL unnest(d.tags) t(name)
WHERE d.organization_id IS NOT NULL AND btrim(t.name)<>''
AND NOT EXISTS (SELECT 1 FROM crm_internal.retired_label_names r WHERE r.organization_id=d.organization_id AND r.name_key=lower(btrim(t.name)))
ORDER BY d.organization_id,lower(btrim(t.name)),btrim(t.name)
ON CONFLICT (organization_id,name_key) DO NOTHING;

-- Existing invalid links cannot cross organizations or turn groups into leads.
UPDATE public.wa_conversations c SET deal_id=NULL
WHERE c.deal_id IS NOT NULL AND (c.is_group OR NOT EXISTS (
 SELECT 1 FROM public.deals d WHERE d.id=c.deal_id AND d.organization_id=c.organization_id AND d.deleted_at IS NULL
));
UPDATE public.wa_conversations c SET label_ids=ARRAY(
 SELECT DISTINCT l.id FROM public.wa_labels l WHERE l.organization_id=c.organization_id AND l.id=ANY(c.label_ids) ORDER BY l.id
);
-- Initial union includes every conversation already linked to this exact lead.
UPDATE public.deals d SET tags=ARRAY(
 SELECT DISTINCT l.name FROM public.wa_labels l WHERE l.organization_id=d.organization_id AND (
 l.name_key IN (SELECT lower(btrim(t)) FROM unnest(d.tags) t)
 OR EXISTS (SELECT 1 FROM public.wa_conversations c WHERE c.deal_id=d.id AND c.organization_id=d.organization_id AND NOT c.is_group AND l.id=ANY(c.label_ids))
 ) ORDER BY l.name
);
UPDATE public.wa_conversations c SET label_ids=ARRAY(
 SELECT l.id FROM public.wa_labels l JOIN public.deals d ON d.id=c.deal_id AND d.organization_id=c.organization_id
 WHERE l.organization_id=c.organization_id AND l.name=ANY(d.tags) ORDER BY l.id
) WHERE c.deal_id IS NOT NULL AND NOT c.is_group;
CREATE INDEX IF NOT EXISTS wa_conversations_linked_labels ON public.wa_conversations(organization_id,deal_id) WHERE deal_id IS NOT NULL AND NOT is_group;

CREATE OR REPLACE FUNCTION crm_internal.normalize_deal_labels() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id
 AND EXISTS(SELECT 1 FROM public.wa_conversations WHERE deal_id=OLD.id) THEN
   RAISE EXCEPTION 'Unlink conversations before moving lead organization' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.tags IS NOT DISTINCT FROM OLD.tags AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 7124));
 INSERT INTO public.wa_labels(organization_id,name)
 SELECT DISTINCT ON (lower(btrim(t))) NEW.organization_id,btrim(t) FROM unnest(NEW.tags) t
 WHERE btrim(t)<>'' AND NOT EXISTS (SELECT 1 FROM crm_internal.retired_label_names r WHERE r.organization_id=NEW.organization_id AND r.name_key=lower(btrim(t)))
 ORDER BY lower(btrim(t)),btrim(t) ON CONFLICT (organization_id,name_key) DO NOTHING;
 NEW.tags:=ARRAY(SELECT l.name FROM public.wa_labels l WHERE l.organization_id=NEW.organization_id
 AND l.name_key IN (SELECT lower(btrim(t)) FROM unnest(NEW.tags) t) ORDER BY l.name);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_internal.fanout_deal_labels() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN
   UPDATE public.wa_conversations SET deal_id=NULL WHERE deal_id=NEW.id AND organization_id=NEW.organization_id;
   RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.tags IS NOT DISTINCT FROM OLD.tags THEN RETURN NEW; END IF;
 SELECT ARRAY(SELECT l.id FROM public.wa_labels l WHERE l.organization_id=NEW.organization_id AND l.name=ANY(NEW.tags) ORDER BY l.id) INTO ids;
 UPDATE public.wa_conversations SET label_ids=ids
 WHERE organization_id=NEW.organization_id AND deal_id=NEW.id AND NOT is_group AND label_ids IS DISTINCT FROM ids;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_internal.validate_conversation_labels() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE linked_tags text[];
BEGIN
 IF EXISTS (SELECT 1 FROM unnest(NEW.label_ids) requested(id) WHERE NOT EXISTS (
   SELECT 1 FROM public.wa_labels l WHERE l.id=requested.id AND l.organization_id=NEW.organization_id
 )) THEN RAISE EXCEPTION 'Invalid label organization' USING ERRCODE='23514'; END IF;
 NEW.label_ids:=ARRAY(SELECT DISTINCT id FROM unnest(NEW.label_ids) id ORDER BY id);
 IF NEW.deal_id IS NOT NULL THEN
   IF NEW.is_group THEN RAISE EXCEPTION 'Groups cannot link to a lead' USING ERRCODE='23514'; END IF;
   SELECT tags INTO linked_tags FROM public.deals WHERE id=NEW.deal_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid lead organization or deleted lead' USING ERRCODE='23514'; END IF;
   IF TG_OP='INSERT' OR NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
     NEW.label_ids:=ARRAY(SELECT l.id FROM public.wa_labels l WHERE l.organization_id=NEW.organization_id AND (l.id=ANY(NEW.label_ids) OR l.name=ANY(linked_tags)) ORDER BY l.id);
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_internal.apply_conversation_labels() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed uuid[]:='{}'; added uuid[]; next_tags text[];
BEGIN
 IF NEW.deal_id IS NULL OR NEW.is_group THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.label_ids IS NOT DISTINCT FROM OLD.label_ids AND NEW.deal_id IS NOT DISTINCT FROM OLD.deal_id THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.deal_id IS NOT DISTINCT FROM OLD.deal_id THEN
   removed:=ARRAY(SELECT id FROM unnest(OLD.label_ids) id WHERE NOT id=ANY(NEW.label_ids));
   added:=ARRAY(SELECT id FROM unnest(NEW.label_ids) id WHERE NOT id=ANY(OLD.label_ids));
 ELSE added:=NEW.label_ids;
 END IF;
 SELECT ARRAY(SELECT l.name FROM public.wa_labels l WHERE l.organization_id=NEW.organization_id
 AND (l.name=ANY(d.tags) OR l.id=ANY(added)) AND NOT l.id=ANY(removed) ORDER BY l.name)
 INTO next_tags FROM public.deals d WHERE d.id=NEW.deal_id AND d.organization_id=NEW.organization_id;
 UPDATE public.deals SET tags=next_tags WHERE id=NEW.deal_id AND organization_id=NEW.organization_id AND tags IS DISTINCT FROM next_tags;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS unified_labels_deal_before ON public.deals;
CREATE TRIGGER unified_labels_deal_before BEFORE INSERT OR UPDATE OF tags,organization_id ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_internal.normalize_deal_labels();
DROP TRIGGER IF EXISTS unified_labels_deal_after ON public.deals;
CREATE TRIGGER unified_labels_deal_after AFTER INSERT OR UPDATE OF tags,deleted_at ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_internal.fanout_deal_labels();
DROP TRIGGER IF EXISTS unified_labels_conversation_before ON public.wa_conversations;
CREATE TRIGGER unified_labels_conversation_before BEFORE INSERT OR UPDATE OF label_ids,deal_id,organization_id,is_group ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION crm_internal.validate_conversation_labels();
DROP TRIGGER IF EXISTS unified_labels_conversation_after ON public.wa_conversations;
CREATE TRIGGER unified_labels_conversation_after AFTER INSERT OR UPDATE OF label_ids,deal_id ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION crm_internal.apply_conversation_labels();

CREATE OR REPLACE FUNCTION crm_internal.catalog_label_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END::text, 7124));
 IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'Cannot move labels between organizations' USING ERRCODE='23514'; END IF;
 IF (TG_OP='DELETE' OR (TG_OP='UPDATE' AND lower(btrim(NEW.name))<>lower(btrim(OLD.name))))
 AND EXISTS(SELECT 1 FROM public.organizations WHERE id=OLD.organization_id) THEN
   INSERT INTO crm_internal.retired_label_names VALUES(OLD.organization_id,lower(btrim(OLD.name))) ON CONFLICT DO NOTHING;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 NEW.name:=btrim(NEW.name);
 NEW.color:=crm_internal.label_color(NEW.color);
 -- Only explicit catalog creation/rename revives a retired name. Array writes don't.
 DELETE FROM crm_internal.retired_label_names WHERE organization_id=NEW.organization_id AND name_key=lower(NEW.name);
 NEW.updated_at:=now();
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION crm_internal.catalog_label_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   UPDATE public.deals SET tags=array_remove(tags,OLD.name) WHERE organization_id=OLD.organization_id AND OLD.name=ANY(tags);
   UPDATE public.wa_conversations SET label_ids=array_remove(label_ids,OLD.id) WHERE organization_id=OLD.organization_id AND OLD.id=ANY(label_ids);
 ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
   UPDATE public.deals SET tags=array_replace(tags,OLD.name,NEW.name) WHERE organization_id=NEW.organization_id AND OLD.name=ANY(tags);
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_wa_labels_after_delete ON public.wa_labels;
DROP TRIGGER IF EXISTS unified_catalog_before ON public.wa_labels;
CREATE TRIGGER unified_catalog_before BEFORE INSERT OR UPDATE OR DELETE ON public.wa_labels FOR EACH ROW EXECUTE FUNCTION crm_internal.catalog_label_before();
DROP TRIGGER IF EXISTS unified_catalog_after ON public.wa_labels;
CREATE TRIGGER unified_catalog_after AFTER UPDATE OR DELETE ON public.wa_labels FOR EACH ROW EXECUTE FUNCTION crm_internal.catalog_label_after();

-- Legacy relation remains writable through RLS of the real catalog.
CREATE OR REPLACE VIEW public.tags WITH (security_invoker=true) AS
 SELECT id,name,CASE color WHEN 'blue' THEN 'bg-sky-500' WHEN 'green' THEN 'bg-emerald-500'
 WHEN 'yellow' THEN 'bg-amber-400' WHEN 'orange' THEN 'bg-orange-500' WHEN 'red' THEN 'bg-rose-500'
 WHEN 'pink' THEN 'bg-pink-500' WHEN 'purple' THEN 'bg-violet-500' WHEN 'teal' THEN 'bg-teal-500'
 ELSE 'bg-slate-400' END AS color,created_at,organization_id FROM public.wa_labels;
CREATE OR REPLACE FUNCTION crm_internal.write_legacy_tag() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM public.wa_labels WHERE id=OLD.id; RETURN OLD;
 ELSIF TG_OP='INSERT' THEN
   INSERT INTO public.wa_labels(id,name,color,created_at,organization_id)
   VALUES(coalesce(NEW.id,gen_random_uuid()),NEW.name,coalesce(NEW.color,'slate'),coalesce(NEW.created_at,now()),NEW.organization_id)
   RETURNING id,created_at INTO NEW.id,NEW.created_at;
 ELSE UPDATE public.wa_labels SET name=NEW.name,color=NEW.color,organization_id=NEW.organization_id WHERE id=OLD.id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tags_write_compatibility ON public.tags;
CREATE TRIGGER tags_write_compatibility INSTEAD OF INSERT OR UPDATE OR DELETE ON public.tags FOR EACH ROW EXECUTE FUNCTION crm_internal.write_legacy_tag();
DROP POLICY IF EXISTS unified_labels_org ON public.wa_labels;
CREATE POLICY unified_labels_org ON public.wa_labels FOR ALL TO authenticated
USING (organization_id IN (SELECT public.user_org_ids(auth.uid())))
WITH CHECK (organization_id IN (SELECT public.user_org_ids(auth.uid())));
REVOKE ALL ON public.tags,public.wa_labels FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tags,public.wa_labels TO authenticated,service_role;

-- Backend-only atomic mutation: acquire the lead first, then the conversation.
DROP FUNCTION IF EXISTS public.mutate_conversation_labels(uuid,uuid,uuid[],uuid[]);
CREATE OR REPLACE FUNCTION public.mutate_conversation_labels(p_org uuid,p_conversation uuid,p_add uuid[] DEFAULT '{}',p_remove uuid[] DEFAULT '{}',p_expected_deal uuid DEFAULT NULL,p_check_link boolean DEFAULT false)
RETURNS public.wa_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.wa_conversations; linked uuid;
BEGIN
 SELECT deal_id INTO linked FROM public.wa_conversations WHERE id=p_conversation AND organization_id=p_org;
 IF linked IS NOT NULL THEN PERFORM 1 FROM public.deals WHERE id=linked AND organization_id=p_org FOR UPDATE; END IF;
 SELECT * INTO c FROM public.wa_conversations WHERE id=p_conversation AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='P0002'; END IF;
 IF p_check_link AND c.deal_id IS DISTINCT FROM p_expected_deal THEN RAISE EXCEPTION 'Conversation link changed; refresh authorization' USING ERRCODE='40001'; END IF;
 IF c.deal_id IS DISTINCT FROM linked THEN RAISE EXCEPTION 'Conversation link changed; retry' USING ERRCODE='40001'; END IF;
 UPDATE public.wa_conversations SET label_ids=ARRAY(SELECT DISTINCT id FROM unnest(c.label_ids || p_add) id WHERE NOT id=ANY(p_remove) ORDER BY id)
 WHERE id=c.id RETURNING * INTO c;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.mutate_conversation_labels(uuid,uuid,uuid[],uuid[],uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_conversation_labels(uuid,uuid,uuid[],uuid[],uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION crm_internal.label_color(text),crm_internal.normalize_deal_labels(),crm_internal.fanout_deal_labels(),crm_internal.validate_conversation_labels(),crm_internal.apply_conversation_labels(),crm_internal.catalog_label_before(),crm_internal.catalog_label_after(),crm_internal.write_legacy_tag() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wa_labels') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_labels; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='wa_conversations') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_conversations; END IF;
 END IF;
END $$;
NOTIFY pgrst, 'reload schema';
