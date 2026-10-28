-- =============================================================================
-- ZapSign: conferir antes de enviar
-- =============================================================================
-- Entrar numa etapa com regra de assinatura NÃO cria mais o documento sozinho.
-- O banco só prepara a linha em deal_signatures com status 'review'
-- ("aguardando conferência"); quem envia é uma pessoa, depois de conferir e
-- ajustar os dados do contrato:
--   - movendo pela tela do CRM, o modal de conferência abre na hora e o envio
--     aproveita essa linha (POST /api/integrations/zapsign/send, rule_stage_id);
--   - movendo por API, robô ou automação, o contrato fica aguardando na aba
--     Contrato do lead, com aviso no histórico.
-- Linha descartada antes do envio (status 'cancelled') não conta como "já
-- enviado": se o lead entrar de novo na etapa, prepara outra vez.
-- Nada existente muda ao aplicar. Idempotente.
-- =============================================================================

ALTER TABLE public.deal_signatures DROP CONSTRAINT IF EXISTS deal_signatures_status_check;
ALTER TABLE public.deal_signatures ADD CONSTRAINT deal_signatures_status_check
  CHECK (status IN ('review', 'queued', 'processing', 'pending', 'signed', 'refused', 'deleted', 'expired', 'failed', 'cancelled'));

CREATE OR REPLACE FUNCTION crm_internal.signature_on_deal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  r record;
  sig_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.board_id IS NOT DISTINCT FROM OLD.board_id THEN
    RETURN NULL;
  END IF;
  IF NEW.stage_id IS NULL OR NEW.deleted_at IS NOT NULL OR coalesce(NEW.is_won, false) OR coalesce(NEW.is_lost, false) THEN
    RETURN NULL;
  END IF;
  SELECT stage_id, organization_id, template_token, template_name INTO r
    FROM public.stage_signature_rules
   WHERE stage_id = NEW.stage_id AND enabled AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zapsign_settings WHERE organization_id = NEW.organization_id) THEN
    RETURN NULL;
  END IF;
  -- uma vez por lead em cada etapa; o que foi descartado antes do envio não conta
  IF EXISTS (
    SELECT 1 FROM public.deal_signatures s
     WHERE s.deal_id = NEW.id AND s.stage_id = NEW.stage_id AND s.origin = 'rule' AND s.status <> 'cancelled'
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.deal_signatures (organization_id, deal_id, contact_id, stage_id, origin, status, template_token, template_name)
  VALUES (NEW.organization_id, NEW.id, NEW.contact_id, NEW.stage_id, 'rule', 'review', r.template_token, r.template_name)
  RETURNING id INTO sig_id;
  -- aviso no histórico do lead (não derruba a preparação se falhar)
  BEGIN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, field, new_value, detail, actor_kind)
    VALUES (
      NEW.organization_id, NEW.id, 'signature', r.template_name, to_jsonb('review'::text),
      jsonb_build_object('provider', 'zapsign', 'signature_id', sig_id, 'stage_id', NEW.stage_id),
      'system'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'signature_on_deal_change: histórico não gravado: %', SQLERRM;
  END;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'signature_on_deal_change falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;
