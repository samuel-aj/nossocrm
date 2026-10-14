-- Service-role-only journal. No browser/API-key holder can bypass application permissions.
CREATE TABLE public.mcp_wa_operations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, api_key_id, operation_id)
);
CREATE TABLE public.mcp_wa_items (
  organization_id uuid NOT NULL,
  api_key_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  item_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','preparing','dispatching','accepted','completed','uncertain')),
  claim_token uuid,
  lease_until timestamptz,
  record jsonb,
  provider_message_id text,
  message_id uuid,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, api_key_id, operation_id, item_id),
  UNIQUE (organization_id, api_key_id, operation_id, position),
  FOREIGN KEY (organization_id, api_key_id, operation_id) REFERENCES public.mcp_wa_operations ON DELETE CASCADE
);
CREATE TABLE public.mcp_wa_uploads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  file_name text NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 8 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  upload_path text NOT NULL,
  sealed_path text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours')
);
CREATE INDEX mcp_wa_upload_scope ON public.mcp_wa_uploads (organization_id,api_key_id);
ALTER TABLE public.mcp_wa_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_wa_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_wa_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_wa_operations, public.mcp_wa_items, public.mcp_wa_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.mcp_wa_operations, public.mcp_wa_items, public.mcp_wa_uploads TO service_role;

CREATE FUNCTION public.mcp_wa_create_operation(p_org uuid, p_key uuid, p_operation uuid, p_actor uuid,
  p_conversation uuid, p_connection uuid, p_hash text, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE existing public.mcp_wa_operations; item jsonb; idx integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;
  INSERT INTO public.mcp_wa_operations(organization_id,api_key_id,operation_id,actor_id,conversation_id,connection_id,payload_hash)
    VALUES(p_org,p_key,p_operation,p_actor,p_conversation,p_connection,p_hash)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT existing FROM public.mcp_wa_operations
    WHERE organization_id=p_org AND api_key_id=p_key AND operation_id=p_operation FOR UPDATE;
  IF existing.payload_hash <> p_hash OR existing.actor_id <> p_actor OR existing.conversation_id <> p_conversation OR existing.connection_id <> p_connection THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.mcp_wa_items WHERE organization_id=p_org AND api_key_id=p_key AND operation_id=p_operation) THEN RETURN; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.mcp_wa_items(organization_id,api_key_id,operation_id,item_id,position,payload)
      VALUES(p_org,p_key,p_operation,(item->>'itemId')::uuid,idx,item);
    idx := idx + 1;
  END LOOP;
END $$;

CREATE FUNCTION public.mcp_wa_claim_item(p_org uuid, p_key uuid, p_operation uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE item public.mcp_wa_items;
BEGIN
  -- Serialize claimers across all items in an operation. Never skip a blocked item.
  PERFORM 1 FROM public.mcp_wa_operations WHERE organization_id=p_org AND api_key_id=p_key AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO item FROM public.mcp_wa_items WHERE organization_id=p_org AND api_key_id=p_key AND operation_id=p_operation
    AND state <> 'completed' ORDER BY position LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF item.state <> 'pending' AND NOT (item.state='preparing' AND item.lease_until < clock_timestamp()) THEN RETURN NULL; END IF;
  UPDATE public.mcp_wa_items SET state='preparing',claim_token=p_token,lease_until=clock_timestamp()+interval '90 seconds',error_code=NULL,updated_at=clock_timestamp()
    WHERE organization_id=p_org AND api_key_id=p_key AND operation_id=p_operation AND item_id=item.item_id RETURNING * INTO item;
  RETURN to_jsonb(item);
END $$;
REVOKE ALL ON FUNCTION public.mcp_wa_create_operation(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), public.mcp_wa_claim_item(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_wa_create_operation(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb), public.mcp_wa_claim_item(uuid,uuid,uuid,uuid) TO service_role;
