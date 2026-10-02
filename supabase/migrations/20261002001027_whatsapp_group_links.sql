-- Optional feature. Access stays in organization-scoped server endpoints.
ALTER TABLE public.organization_settings ADD COLUMN wa_group_links_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX contacts_group_links_org_id ON public.contacts(organization_id, id);
CREATE UNIQUE INDEX deals_group_links_org_id ON public.deals(organization_id, id);

CREATE TABLE public.wa_group_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = btrim(provider) AND provider <> ''),
  external_id text NOT NULL CHECK (external_id ~ '^[^[:space:]@]+@g[.]us$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, external_id),
  UNIQUE (organization_id, id)
);
CREATE TABLE public.wa_group_contact_links (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, group_id, contact_id),
  FOREIGN KEY (organization_id, group_id) REFERENCES public.wa_group_entities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES public.contacts(organization_id, id) ON DELETE CASCADE
);
CREATE TABLE public.wa_group_deal_links (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, group_id, deal_id),
  FOREIGN KEY (organization_id, group_id) REFERENCES public.wa_group_entities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, deal_id) REFERENCES public.deals(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX wa_group_contact_links_contact ON public.wa_group_contact_links(organization_id, contact_id);
CREATE INDEX wa_group_deal_links_deal ON public.wa_group_deal_links(organization_id, deal_id);
CREATE UNIQUE INDEX wa_group_deal_links_one_primary ON public.wa_group_deal_links(organization_id, deal_id) WHERE is_primary;
ALTER TABLE public.wa_group_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_group_contact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_group_deal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_group_entities, public.wa_group_contact_links, public.wa_group_deal_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.wa_group_entities, public.wa_group_contact_links, public.wa_group_deal_links TO service_role;

-- Only trusted endpoints call this after checking both conversation and entity visibility.
-- Derive registry identity from the persisted conversation, never from client-supplied JIDs.
CREATE FUNCTION public.mutate_whatsapp_group_link(p_organization_id uuid, p_conversation_id uuid, p_entity_type text, p_entity_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_enabled boolean;
  v_connection uuid;
  v_provider text;
  v_external_id text;
  v_group_id uuid;
  v_first boolean;
BEGIN
  IF p_entity_type NOT IN ('contact', 'deal') OR p_action NOT IN ('link', 'unlink', 'set_primary') OR
     p_entity_type IS NULL OR p_action IS NULL OR (p_entity_type = 'contact' AND p_action = 'set_primary') THEN
    RAISE EXCEPTION 'Invalid group link action' USING ERRCODE = '22023';
  END IF;
  -- Holding the feature row prevents a concurrent disable from committing before this write.
  SELECT wa_group_links_enabled INTO v_enabled FROM public.organization_settings
    WHERE organization_id = p_organization_id FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Group links disabled' USING ERRCODE = '55000'; END IF;
  SELECT connection_id, coalesce(group_jid, wa_phone) INTO v_connection, v_external_id
    FROM public.wa_conversations WHERE organization_id = p_organization_id AND id = p_conversation_id AND is_group FOR SHARE;
  IF NOT FOUND OR v_connection IS NULL OR v_external_id IS NULL OR v_external_id !~ '^[^[:space:]@]+@g[.]us$' THEN
    RAISE EXCEPTION 'Group unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT provider INTO v_provider FROM public.wa_connections
    WHERE organization_id = p_organization_id AND id = v_connection FOR SHARE;
  IF NOT FOUND OR v_provider IS NULL OR v_provider = '' OR v_provider <> btrim(v_provider) THEN
    RAISE EXCEPTION 'Group connection unavailable' USING ERRCODE = '22023';
  END IF;
  -- Row locks serialize all principal decisions for the lead, including the empty-link case.
  IF p_entity_type = 'deal' THEN
    PERFORM 1 FROM public.deals WHERE organization_id = p_organization_id AND id = p_entity_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.contacts WHERE organization_id = p_organization_id AND id = p_entity_id AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entity unavailable' USING ERRCODE = '22023'; END IF;
  IF p_action = 'link' THEN
    INSERT INTO public.wa_group_entities(organization_id, provider, external_id) VALUES (p_organization_id, v_provider, v_external_id)
      ON CONFLICT (organization_id, provider, external_id) DO NOTHING;
  END IF;
  SELECT id INTO v_group_id FROM public.wa_group_entities
    WHERE organization_id = p_organization_id AND provider = v_provider AND external_id = v_external_id;
  IF v_group_id IS NULL THEN
    IF p_action = 'unlink' THEN RETURN; END IF;
    RAISE EXCEPTION 'Group is not linked' USING ERRCODE = '22023';
  END IF;
  IF p_entity_type = 'contact' THEN
    IF p_action = 'link' THEN
      INSERT INTO public.wa_group_contact_links(organization_id, group_id, contact_id) VALUES (p_organization_id, v_group_id, p_entity_id) ON CONFLICT DO NOTHING;
    ELSE
      DELETE FROM public.wa_group_contact_links WHERE organization_id = p_organization_id AND group_id = v_group_id AND contact_id = p_entity_id;
    END IF;
  ELSIF p_action = 'link' THEN
    SELECT NOT EXISTS(SELECT 1 FROM public.wa_group_deal_links WHERE organization_id = p_organization_id AND deal_id = p_entity_id) INTO v_first;
    INSERT INTO public.wa_group_deal_links(organization_id, group_id, deal_id, is_primary) VALUES (p_organization_id, v_group_id, p_entity_id, v_first) ON CONFLICT DO NOTHING;
  ELSIF p_action = 'unlink' THEN
    DELETE FROM public.wa_group_deal_links WHERE organization_id = p_organization_id AND group_id = v_group_id AND deal_id = p_entity_id;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.wa_group_deal_links WHERE organization_id = p_organization_id AND group_id = v_group_id AND deal_id = p_entity_id) THEN
      RAISE EXCEPTION 'Group is not linked' USING ERRCODE = '22023';
    END IF;
    UPDATE public.wa_group_deal_links SET is_primary = false WHERE organization_id = p_organization_id AND deal_id = p_entity_id AND is_primary;
    UPDATE public.wa_group_deal_links SET is_primary = true WHERE organization_id = p_organization_id AND deal_id = p_entity_id AND group_id = v_group_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mutate_whatsapp_group_link(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_whatsapp_group_link(uuid, uuid, text, uuid, text) TO service_role;

-- Atomic feature + principal lookup for trusted server webhooks. UI resolves visibility separately.
CREATE FUNCTION public.deal_whatsapp_group_field(p_organization_id uuid, p_deal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN coalesce((SELECT s.wa_group_links_enabled FROM public.organization_settings s WHERE s.organization_id = p_organization_id), false)
    THEN jsonb_build_object('whatsapp_group_id', (
      SELECT g.external_id FROM public.wa_group_deal_links l
      JOIN public.wa_group_entities g ON g.organization_id = l.organization_id AND g.id = l.group_id
      JOIN public.deals d ON d.organization_id = l.organization_id AND d.id = l.deal_id
      WHERE l.organization_id = p_organization_id AND l.deal_id = p_deal_id AND l.is_primary AND d.deleted_at IS NULL
    )) ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.deal_whatsapp_group_field(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deal_whatsapp_group_field(uuid, uuid) TO service_role;
