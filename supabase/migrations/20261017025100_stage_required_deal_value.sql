-- Add the native deal amount to stage entry requirements. No existing stage
-- configuration or deal is rewritten. Existing function signatures, triggers,
-- SECURITY INVOKER/DEFINER modes and execution grants are preserved.

CREATE OR REPLACE FUNCTION crm_internal.guard_stage_required_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.required_fields IS NOT DISTINCT FROM OLD.required_fields
    AND NEW.organization_id=OLD.organization_id THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND coalesce(private.team_org_role(NEW.organization_id,auth.uid()),'') NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Somente administradores podem configurar campos obrigatórios' USING ERRCODE='42501';
  END IF;
  IF cardinality(NEW.required_fields)>100 OR array_position(NEW.required_fields,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Lista de campos obrigatórios inválida';
  END IF;
  FOREACH r IN ARRAY NEW.required_fields LOOP
    IF r IN ('value','products','leadSource','ownerId') THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.custom_field_definitions f WHERE 'custom:'||f.id::text=r
      AND f.organization_id=NEW.organization_id AND f.entity_type='deal') THEN
      RAISE EXCEPTION 'Campo obrigatório indisponível nesta organização';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.validate_stage_required_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE req text[]; r text; f public.custom_field_definitions; absent text[]:='{}'; source text;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.board_id IS NOT DISTINCT FROM OLD.board_id THEN RETURN NEW; END IF;
  SELECT s.required_fields INTO req FROM public.board_stages s
    WHERE s.id=NEW.stage_id AND s.board_id=NEW.board_id AND s.organization_id=NEW.organization_id FOR SHARE;
  FOREACH r IN ARRAY coalesce(req,'{}') LOOP
    IF r='value' THEN
      IF NEW.value IS NULL OR NEW.value<=0 OR NEW.value::text IN ('NaN','Infinity','-Infinity') THEN
        absent:=array_append(absent,'Valor do negócio (maior que R$ 0,00)');
      END IF;
    ELSIF r='products' THEN
      IF NOT EXISTS (SELECT 1 FROM public.deal_items i WHERE i.deal_id=NEW.id AND i.organization_id=NEW.organization_id
        AND i.quantity>0 AND i.price>=0 AND btrim(i.name)<>'') THEN absent:=array_append(absent,'Produto'); END IF;
    ELSIF r='leadSource' THEN
      source:=crm_internal.read_deal_lead_source(NEW);
      IF source IS NULL OR lower(btrim(source))='não informado' THEN absent:=array_append(absent,'Origem do lead'); END IF;
    ELSIF r='ownerId' THEN
      IF NEW.owner_id IS NULL OR NOT private.team_is_org_member(NEW.organization_id,NEW.owner_id) THEN absent:=array_append(absent,'Responsável'); END IF;
    ELSE
      SELECT * INTO f FROM public.custom_field_definitions WHERE 'custom:'||id::text=r
        AND organization_id=NEW.organization_id AND entity_type='deal';
      IF NOT FOUND THEN absent:=array_append(absent,'Campo indisponível');
      ELSIF NOT crm_internal.custom_stage_value_filled(f.type,NEW.custom_fields->f.key,f.options) THEN absent:=array_append(absent,f.label); END IF;
    END IF;
  END LOOP;
  IF cardinality(absent)>0 THEN
    RAISE EXCEPTION 'Preencha os campos obrigatórios da etapa: %',array_to_string(absent,', ')
      USING ERRCODE='P0001',DETAIL=jsonb_build_object('code','STAGE_REQUIRED_FIELDS','fields',absent)::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deal_stage_move(
  p_deal_id uuid,p_expected_board_id uuid,p_expected_stage_id uuid,p_target_board_id uuid,p_target_stage_id uuid,
  p_changes jsonb DEFAULT '{}',p_values jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.deals; result public.deals; target public.board_stages; product public.products;
  owner uuid; custom_delta jsonb; item jsonb; item_price numeric; item_qty integer; total numeric; deal_value numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_changes)<>'object' OR jsonb_typeof(p_values)<>'object'
    OR p_changes IS NULL OR p_values IS NULL THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('isWon','isLost','lossReason','lossCategory'))
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('value','leadSource','ownerId','customFields','product')) THEN
    RAISE EXCEPTION 'Campo de atualização inválido';
  END IF;
  SELECT * INTO d FROM public.deals WHERE id=p_deal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead indisponível' USING ERRCODE='42501'; END IF;
  IF d.board_id IS DISTINCT FROM p_expected_board_id OR d.stage_id IS DISTINCT FROM p_expected_stage_id THEN
    RAISE EXCEPTION 'O lead mudou de etapa. Atualize e tente novamente' USING ERRCODE='40001';
  END IF;
  SELECT * INTO target FROM public.board_stages WHERE id=p_target_stage_id AND board_id=p_target_board_id
    AND organization_id=d.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etapa indisponível neste funil' USING ERRCODE='42501'; END IF;
  owner:=CASE WHEN p_values?'ownerId' THEN (p_values->>'ownerId')::uuid ELSE d.owner_id END;
  PERFORM crm_internal.assert_stage_completion_access(d,p_target_board_id,owner,p_values<>'{}'::jsonb);
  custom_delta:=coalesce(p_values->'customFields','{}'::jsonb);
  IF jsonb_typeof(custom_delta)<>'object' THEN RAISE EXCEPTION 'Campos personalizados inválidos'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(custom_delta) k WHERE NOT EXISTS(
    SELECT 1 FROM public.custom_field_definitions f WHERE f.organization_id=d.organization_id AND f.entity_type='deal'
      AND f.key=k AND ('custom:'||f.id::text)=ANY(target.required_fields))) THEN
    RAISE EXCEPTION 'Campo personalizado não exigido pela etapa';
  END IF;
  IF (p_values?'value' AND NOT 'value'=ANY(target.required_fields))
    OR (p_values?'leadSource' AND NOT 'leadSource'=ANY(target.required_fields))
    OR (p_values?'ownerId' AND NOT 'ownerId'=ANY(target.required_fields))
    OR (p_values?'product' AND NOT 'products'=ANY(target.required_fields)) THEN
    RAISE EXCEPTION 'A configuração da etapa mudou. Atualize e tente novamente';
  END IF;
  IF p_values?'value' THEN
    IF jsonb_typeof(p_values->'value') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Informe um valor do negócio maior que R$ 0,00';
    END IF;
    deal_value:=(p_values->>'value')::numeric;
    IF deal_value<=0 OR deal_value::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Informe um valor do negócio maior que R$ 0,00';
    END IF;
  ELSIF 'value'=ANY(target.required_fields) AND d.value>0
    AND d.value::text NOT IN ('NaN','Infinity','-Infinity') THEN
    -- An already completed required amount must not be replaced by the product
    -- selected for a different pending field in this same dialog.
    deal_value:=d.value;
  END IF;
  item:=p_values->'product';
  IF item IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.deal_items WHERE deal_id=d.id AND organization_id=d.organization_id AND quantity>0 AND price>=0 AND btrim(name)<>'') THEN
      RAISE EXCEPTION 'Um produto já foi adicionado a este lead. Feche e tente mover novamente';
    END IF;
    SELECT * INTO product FROM public.products WHERE id=(item->>'productId')::uuid AND organization_id=d.organization_id AND active IS DISTINCT FROM false;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto indisponível nesta organização'; END IF;
    item_price:=(item->>'price')::numeric; item_qty:=(item->>'quantity')::integer;
    IF item_price IS NULL OR item_price<0 OR item_price::text IN ('NaN','Infinity','-Infinity')
      OR item_qty IS NULL OR item_qty<1 OR (item->>'quantity')::numeric<>item_qty THEN RAISE EXCEPTION 'Preço ou quantidade inválidos'; END IF;
    INSERT INTO public.deal_items(organization_id,deal_id,product_id,name,quantity,price)
      VALUES(d.organization_id,d.id,product.id,product.name,item_qty,item_price);
    SELECT coalesce(sum(price*quantity),0) INTO total FROM public.deal_items WHERE deal_id=d.id AND organization_id=d.organization_id;
  END IF;
  UPDATE public.deals SET board_id=p_target_board_id,stage_id=p_target_stage_id,
    custom_fields=coalesce(d.custom_fields,'{}')||custom_delta,
    lead_source=CASE WHEN p_values?'leadSource' THEN p_values->>'leadSource' ELSE crm_internal.read_deal_lead_source(d) END,
    owner_id=owner,value=coalesce(deal_value,total,d.value),
    is_won=CASE WHEN p_changes?'isWon' THEN (p_changes->>'isWon')::boolean ELSE d.is_won END,
    is_lost=CASE WHEN p_changes?'isLost' THEN (p_changes->>'isLost')::boolean ELSE d.is_lost END,
    loss_reason=CASE WHEN p_changes?'lossReason' THEN p_changes->>'lossReason' ELSE d.loss_reason END,
    loss_category=CASE WHEN p_changes?'lossCategory' THEN p_changes->>'lossCategory' ELSE d.loss_category END,
    inactive_at=NULL,updated_at=now()
    WHERE id=d.id RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão para mover este lead' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('deal',to_jsonb(result),'items',coalesce((SELECT jsonb_agg(to_jsonb(i))
    FROM public.deal_items i WHERE i.deal_id=d.id AND i.organization_id=d.organization_id),'[]'));
END;
$$;
