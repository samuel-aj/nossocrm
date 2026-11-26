-- Usar ANTES de voltar o código se um resultado de contrato foi habilitado.
-- Ajustar os três identificadores abaixo para o resultado específico.
-- Restaura a extração anterior apenas nas variáveis contrato_* ainda cadastradas.
-- Dados de conversas, negócios, URLs, credenciais e outros resultados são preservados.
DO $$
DECLARE
  org_id uuid := null;
  agent_id uuid := null;
  outcome_key text := null;
  all_outcomes jsonb;
  variables jsonb;
  item jsonb;
  change jsonb;
  variable text;
  oi integer;
  ci integer;
BEGIN
  IF org_id IS NULL OR agent_id IS NULL OR outcome_key IS NULL THEN
    RAISE EXCEPTION 'Indique organização, agente e resultado antes de executar.';
  END IF;
  SELECT outcomes, ai_vars INTO STRICT all_outcomes, variables
    FROM public.wa_ai_agents WHERE organization_id = org_id AND id = agent_id FOR UPDATE;
  SELECT (ordinality - 1)::integer, value INTO STRICT oi, item
    FROM jsonb_array_elements(all_outcomes) WITH ORDINALITY WHERE value->>'key' = outcome_key;
  IF NOT (item ? 'required_data') OR item #>> '{actions,0,type}' <> 'update_lead' THEN
    RAISE EXCEPTION 'A configuração não corresponde à publicação.';
  END IF;
  FOR ci, change IN SELECT (ordinality - 1)::integer, value
    FROM jsonb_array_elements(item #> '{actions,0,changes}') WITH ORDINALITY
  LOOP
    variable := substring(change->>'value' from '^\{\{dados\.([a-z0-9_]+)\}\}$');
    IF variable IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(variables) v WHERE v->>'name' = 'contrato_' || variable) THEN
      RAISE EXCEPTION 'Mapeamento alterado. Revise antes de tentar novamente.';
    END IF;
    item := jsonb_set(item, ARRAY['actions','0','changes',ci::text,'value'], to_jsonb('{{ia:contrato_' || variable || '}}'));
  END LOOP;
  UPDATE public.wa_ai_agents SET outcomes = jsonb_set(all_outcomes, ARRAY[oi::text], item - 'required_data' - 'acknowledgement'),
    updated_at = now() WHERE organization_id = org_id AND id = agent_id;
END
$$;
