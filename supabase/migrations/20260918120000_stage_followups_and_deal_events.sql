-- =============================================================================
-- Follow-up por inatividade do lead em cada etapa + histórico do lead com autor
-- =============================================================================
-- 1) stage_followup_rules: uma regra por etapa (começa DESLIGADA; nada existente
--    muda ao aplicar esta migração).
-- 2) deal_followup_schedules: um agendamento por negócio, mantido pelo BANCO
--    (gatilhos): entrada na etapa, mensagem do lead, ganho/perda/exclusão e
--    mudança da regra. O app só executa o que venceu (tick a cada 30 s).
-- 3) deal_events: histórico do lead (etapa, responsável, valor, tags, campos,
--    descrição, produtos, ganho/perda, atividades concluídas, follow-ups), com
--    o AUTOR: usuário logado (JWT), ou o que o servidor informar no cabeçalho
--    x-crm-actor-kind / x-crm-actor-id (robô, agente, integração); sem nada
--    disso, "sistema".
-- Idempotente (pode rodar de novo).
-- =============================================================================

-- ---------------------------------------------------------------- 1. Regras
CREATE TABLE IF NOT EXISTS public.stage_followup_rules (
  stage_id uuid PRIMARY KEY REFERENCES public.board_stages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  delay_seconds integer NOT NULL CHECK (delay_seconds BETWEEN 60 AND 2592000),
  action_type text NOT NULL CHECK (action_type IN ('bot', 'message')),
  bot_id uuid REFERENCES public.wa_bots(id) ON DELETE SET NULL,
  -- mensagem: {"kind":"text","text":"..."} ou {"kind":"template","template_id":"..."}
  message jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- quando foi ligada: piso da contagem (ligar a regra nunca dispara em massa o passado)
  activated_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS stage_followup_rules_org_idx ON public.stage_followup_rules (organization_id);

-- ---------------------------------------------------------------- 2. Agendamentos
CREATE TABLE IF NOT EXISTS public.deal_followup_schedules (
  deal_id uuid PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  rule_version integer NOT NULL,
  entered_at timestamptz NOT NULL,          -- entrada na etapa
  anchor_at timestamptz NOT NULL,           -- início da contagem do silêncio
  due_at timestamptz NOT NULL,              -- quando a ação vence
  status text NOT NULL CHECK (status IN ('scheduled', 'processing', 'done', 'failed', 'skipped', 'cancelled')),
  lock_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  fired_at timestamptz,                     -- última execução (um disparo por período de silêncio)
  last_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_followup_schedules_due_idx
  ON public.deal_followup_schedules (due_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS deal_followup_schedules_stage_idx ON public.deal_followup_schedules (stage_id);

-- ---------------------------------------------------------------- 3. Histórico
CREATE TABLE IF NOT EXISTS public.deal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  kind text NOT NULL,          -- created, stage, owner, value, title, tags, custom_field, description, won, lost, reopened, deleted, product, activity_done, followup, automation
  field text,                  -- chave do campo personalizado / nome do produto
  old_value jsonb,
  new_value jsonb,
  detail jsonb,
  actor_kind text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('user', 'bot', 'agent', 'integration', 'system')),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_events_deal_idx ON public.deal_events (deal_id, created_at DESC);
-- início do histórico na organização (antes disso a linha do tempo usa os registros antigos)
CREATE INDEX IF NOT EXISTS deal_events_org_idx ON public.deal_events (organization_id, created_at);

ALTER TABLE public.stage_followup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_followup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stage_followup_rules_select ON public.stage_followup_rules;
CREATE POLICY stage_followup_rules_select ON public.stage_followup_rules
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));
DROP POLICY IF EXISTS deal_followup_schedules_select ON public.deal_followup_schedules;
CREATE POLICY deal_followup_schedules_select ON public.deal_followup_schedules
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));
DROP POLICY IF EXISTS deal_events_select ON public.deal_events;
CREATE POLICY deal_events_select ON public.deal_events
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));
-- Escrita só pelo servidor (service role) e pelos gatilhos abaixo (SECURITY DEFINER).

-- ---------------------------------------------------------------- Autor da alteração
CREATE OR REPLACE FUNCTION crm_internal.current_actor(OUT kind text, OUT id uuid)
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE
  claims jsonb;
  headers jsonb;
  h_kind text;
  h_id text;
BEGIN
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN claims := NULL;
  END;
  -- Usuário logado: é sempre ele (o cabeçalho é ignorado, senão daria para se
  -- passar por robô mandando o cabeçalho pelo navegador).
  IF claims ->> 'role' = 'authenticated' AND (claims ->> 'sub') IS NOT NULL THEN
    kind := 'user';
    id := (claims ->> 'sub')::uuid;
    RETURN;
  END IF;
  -- Só o servidor (service role) informa o autor pelo cabeçalho.
  IF claims ->> 'role' = 'service_role' THEN
    BEGIN
      headers := nullif(current_setting('request.headers', true), '')::jsonb;
    EXCEPTION WHEN OTHERS THEN headers := NULL;
    END;
    h_kind := headers ->> 'x-crm-actor-kind';
    h_id := headers ->> 'x-crm-actor-id';
    IF h_kind IN ('user', 'bot', 'agent', 'integration', 'system') THEN
      kind := h_kind;
      id := CASE WHEN h_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN h_id::uuid END;
      RETURN;
    END IF;
  END IF;
  kind := 'system';
  id := NULL;
END;
$$;

-- ---------------------------------------------------------------- Histórico: negócio
CREATE OR REPLACE FUNCTION crm_internal.capture_deal_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  a record;
  k text;
  old_cf jsonb;
  new_cf jsonb;
BEGIN
  SELECT * INTO a FROM crm_internal.current_actor();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, new_value, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'created', to_jsonb(NEW.stage_id),
            jsonb_build_object('board_id', NEW.board_id, 'title', NEW.title), a.kind, a.id);
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'deleted', a.kind, a.id);
  END IF;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'stage', to_jsonb(OLD.stage_id), to_jsonb(NEW.stage_id),
            jsonb_build_object('old_board_id', OLD.board_id, 'board_id', NEW.board_id), a.kind, a.id);
  END IF;
  IF NEW.is_won AND NOT coalesce(OLD.is_won, false) THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'won', a.kind, a.id);
  END IF;
  IF NEW.is_lost AND NOT coalesce(OLD.is_lost, false) THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'lost',
            jsonb_build_object('reason', NEW.loss_reason, 'category', NEW.loss_category), a.kind, a.id);
  ELSIF NEW.is_lost AND (NEW.loss_reason IS DISTINCT FROM OLD.loss_reason OR NEW.loss_category IS DISTINCT FROM OLD.loss_category) THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'lost',
            jsonb_build_object('reason', NEW.loss_reason, 'category', NEW.loss_category, 'updated', true), a.kind, a.id);
  END IF;
  IF (coalesce(OLD.is_won, false) OR coalesce(OLD.is_lost, false)) AND NOT coalesce(NEW.is_won, false) AND NOT coalesce(NEW.is_lost, false) THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'reopened', a.kind, a.id);
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'owner', to_jsonb(OLD.owner_id), to_jsonb(NEW.owner_id), a.kind, a.id);
  END IF;
  IF NEW.value IS DISTINCT FROM OLD.value THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'value', to_jsonb(OLD.value), to_jsonb(NEW.value), a.kind, a.id);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'title', to_jsonb(OLD.title), to_jsonb(NEW.title), a.kind, a.id);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'description', to_jsonb(OLD.description), to_jsonb(NEW.description), a.kind, a.id);
  END IF;
  IF NEW.tags IS DISTINCT FROM OLD.tags THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, old_value, new_value, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.id, 'tags', to_jsonb(OLD.tags), to_jsonb(NEW.tags), a.kind, a.id);
  END IF;
  IF NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN
    old_cf := coalesce(OLD.custom_fields, '{}'::jsonb);
    new_cf := coalesce(NEW.custom_fields, '{}'::jsonb);
    FOR k IN SELECT DISTINCT key FROM (SELECT jsonb_object_keys(old_cf) AS key UNION SELECT jsonb_object_keys(new_cf)) s LOOP
      IF (old_cf -> k) IS DISTINCT FROM (new_cf -> k) THEN
        INSERT INTO public.deal_events (organization_id, deal_id, kind, field, old_value, new_value, actor_kind, actor_id)
        VALUES (NEW.organization_id, NEW.id, 'custom_field', k, old_cf -> k, new_cf -> k, a.kind, a.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- o histórico nunca impede a gravação do negócio
  RAISE WARNING 'capture_deal_events falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_deal_events ON public.deals;
CREATE TRIGGER trg_capture_deal_events
  AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.capture_deal_events();

-- ---------------------------------------------------------------- Histórico: produtos
CREATE OR REPLACE FUNCTION crm_internal.capture_deal_item_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  a record;
  r record;
BEGIN
  SELECT * INTO a FROM crm_internal.current_actor();
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF r.deal_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.deal_events (organization_id, deal_id, kind, field, old_value, new_value, detail, actor_kind, actor_id)
  VALUES (
    r.organization_id, r.deal_id, 'product', r.name,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('quantity', OLD.quantity, 'price', OLD.price) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('quantity', NEW.quantity, 'price', NEW.price) END,
    jsonb_build_object('op', lower(TG_OP)), a.kind, a.id
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'capture_deal_item_events falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_deal_item_events ON public.deal_items;
CREATE TRIGGER trg_capture_deal_item_events
  AFTER INSERT OR UPDATE OR DELETE ON public.deal_items
  FOR EACH ROW EXECUTE FUNCTION crm_internal.capture_deal_item_events();

-- ---------------------------------------------------------------- Histórico: atividade concluída
-- Autor das atividades e notas (antes nada era gravado: registros antigos
-- ficam sem autor, sem inventar) e marca de edição das notas.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS created_actor_kind text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS edited_by uuid;

CREATE OR REPLACE FUNCTION crm_internal.stamp_activity_author()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM crm_internal.current_actor();
  IF TG_OP = 'INSERT' THEN
    NEW.created_actor_kind := coalesce(NEW.created_actor_kind, a.kind);
    NEW.created_by := coalesce(NEW.created_by, a.id);
    NEW.edited_at := NULL;
    NEW.edited_by := NULL;
  ELSIF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
    NEW.edited_at := now();
    NEW.edited_by := a.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_activity_author ON public.activities;
CREATE TRIGGER trg_stamp_activity_author
  BEFORE INSERT OR UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION crm_internal.stamp_activity_author();

CREATE OR REPLACE FUNCTION crm_internal.capture_activity_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  a record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deal_id IS NULL OR OLD.type = 'STATUS_CHANGE' THEN
      RETURN NULL;
    END IF;
    SELECT * INTO a FROM crm_internal.current_actor();
    INSERT INTO public.deal_events (organization_id, deal_id, kind, field, old_value, detail, actor_kind, actor_id)
    VALUES (OLD.organization_id, OLD.deal_id, 'activity_deleted', OLD.title,
            CASE WHEN OLD.type IN ('NOTE', 'note') THEN to_jsonb(left(coalesce(OLD.description, ''), 300)) END,
            jsonb_build_object('activity_id', OLD.id, 'type', OLD.type), a.kind, a.id);
    RETURN NULL;
  END IF;
  IF NEW.deal_id IS NULL OR NEW.type IN ('NOTE', 'note', 'STATUS_CHANGE') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM crm_internal.current_actor();
  IF NEW.completed IS DISTINCT FROM OLD.completed THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, field, new_value, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.deal_id, CASE WHEN NEW.completed THEN 'activity_done' ELSE 'activity_reopened' END,
            NEW.title, to_jsonb(NEW.completed), jsonb_build_object('activity_id', NEW.id, 'type', NEW.type), a.kind, a.id);
  END IF;
  IF NEW.date IS DISTINCT FROM OLD.date THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, field, old_value, new_value, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.deal_id, 'activity_rescheduled', NEW.title, to_jsonb(OLD.date), to_jsonb(NEW.date),
            jsonb_build_object('activity_id', NEW.id, 'type', NEW.type), a.kind, a.id);
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO public.deal_events (organization_id, deal_id, kind, field, detail, actor_kind, actor_id)
    VALUES (NEW.organization_id, NEW.deal_id, 'activity_deleted', NEW.title,
            jsonb_build_object('activity_id', NEW.id, 'type', NEW.type), a.kind, a.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'capture_activity_events falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_activity_events ON public.activities;
CREATE TRIGGER trg_capture_activity_events
  AFTER UPDATE OR DELETE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION crm_internal.capture_activity_events();

-- ---------------------------------------------------------------- Follow-up: cálculo
-- Última mensagem RECEBIDA do lead (não grupo) a partir de `since`, pela
-- conversa do negócio ou, sem conversa ligada, pelas conversas do contato.
CREATE OR REPLACE FUNCTION crm_internal.followup_last_inbound(p_deal uuid, p_since timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT max(m.created_at)
  FROM public.deals d
  JOIN public.wa_conversations c
    ON c.organization_id = d.organization_id
   AND coalesce(c.is_group, false) = false
   AND (c.deal_id = d.id OR (d.contact_id IS NOT NULL AND c.contact_id = d.contact_id))
  JOIN public.wa_messages m ON m.conversation_id = c.id
  WHERE d.id = p_deal
    AND m.direction = 'in'
    AND m.created_at >= p_since;
$$;

-- Recalcula o agendamento de UM negócio. p_entered: quando ele entrou na etapa
-- atual (null = descobre pelo histórico de etapas).
CREATE OR REPLACE FUNCTION crm_internal.followup_reschedule_deal(p_deal uuid, p_entered timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  d record;
  r record;
  s record;
  entered timestamptz;
  anchor timestamptz;
  last_in timestamptz;
BEGIN
  SELECT id, organization_id, stage_id, is_won, is_lost, deleted_at, created_at, last_stage_change_date
    INTO d FROM public.deals WHERE id = p_deal;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM public.deal_followup_schedules WHERE deal_id = p_deal;

  SELECT * INTO r FROM public.stage_followup_rules WHERE stage_id = d.stage_id AND enabled;
  IF d.deleted_at IS NOT NULL OR coalesce(d.is_won, false) OR coalesce(d.is_lost, false) OR r.stage_id IS NULL THEN
    UPDATE public.deal_followup_schedules
       SET status = 'cancelled', lock_until = NULL, updated_at = now()
     WHERE deal_id = p_deal AND status IN ('scheduled', 'processing');
    RETURN;
  END IF;

  entered := p_entered;
  IF entered IS NULL AND s.deal_id IS NOT NULL AND s.stage_id = d.stage_id THEN
    entered := s.entered_at;
  END IF;
  IF entered IS NULL THEN
    SELECT max(occurred_at) INTO entered FROM public.deal_stage_events
     WHERE deal_id = p_deal AND to_stage_id = d.stage_id;
    entered := coalesce(entered, d.last_stage_change_date, d.created_at, now());
  END IF;

  last_in := crm_internal.followup_last_inbound(p_deal, entered);
  -- Contagem: entrada na etapa, última mensagem do lead depois dela, e nunca antes de a regra ser ligada
  anchor := greatest(entered, coalesce(last_in, entered), coalesce(r.activated_at, entered));

  -- Já disparou para este mesmo período de silêncio: não repete
  IF s.deal_id IS NOT NULL AND s.stage_id = d.stage_id AND s.entered_at = entered
     AND s.fired_at IS NOT NULL AND s.fired_at >= anchor THEN
    UPDATE public.deal_followup_schedules
       SET rule_version = r.version, updated_at = now()
     WHERE deal_id = p_deal;
    RETURN;
  END IF;

  INSERT INTO public.deal_followup_schedules
    (deal_id, organization_id, stage_id, rule_version, entered_at, anchor_at, due_at, status, lock_until, attempts, fired_at, last_result, updated_at)
  VALUES
    (p_deal, d.organization_id, d.stage_id, r.version, entered, anchor, anchor + make_interval(secs => r.delay_seconds),
     'scheduled', NULL, 0, NULL, NULL, now())
  ON CONFLICT (deal_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    stage_id = EXCLUDED.stage_id,
    rule_version = EXCLUDED.rule_version,
    entered_at = EXCLUDED.entered_at,
    anchor_at = EXCLUDED.anchor_at,
    due_at = EXCLUDED.due_at,
    status = 'scheduled',
    lock_until = NULL,
    attempts = 0,
    -- nova entrada na etapa zera o "já disparou"; mesma entrada mantém o registro
    fired_at = CASE WHEN public.deal_followup_schedules.stage_id = EXCLUDED.stage_id
                     AND public.deal_followup_schedules.entered_at = EXCLUDED.entered_at
                    THEN public.deal_followup_schedules.fired_at END,
    updated_at = now();
END;
$$;

-- Negócio: entrou numa etapa (inclusive voltou a ela), mudou de funil, ganhou,
-- perdeu, foi excluído ou reaberto.
CREATE OR REPLACE FUNCTION crm_internal.followup_on_deal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.stage_followup_rules WHERE stage_id = NEW.stage_id AND enabled) THEN
      PERFORM crm_internal.followup_reschedule_deal(NEW.id, now());
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    PERFORM crm_internal.followup_reschedule_deal(NEW.id, now());
  ELSIF NEW.is_won IS DISTINCT FROM OLD.is_won OR NEW.is_lost IS DISTINCT FROM OLD.is_lost
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM crm_internal.followup_reschedule_deal(NEW.id, NULL);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'followup_on_deal_change falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_on_deal_change ON public.deals;
CREATE TRIGGER trg_followup_on_deal_change
  AFTER INSERT OR UPDATE OF stage_id, board_id, is_won, is_lost, deleted_at ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.followup_on_deal_change();

-- Mensagem RECEBIDA do lead: reinicia a contagem de todos os agendamentos dele
-- (inclusive os que já dispararam: a resposta rearma a regra).
CREATE OR REPLACE FUNCTION crm_internal.followup_on_inbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  c record;
BEGIN
  IF NEW.direction <> 'in' THEN
    RETURN NULL;
  END IF;
  SELECT id, organization_id, contact_id, deal_id, coalesce(is_group, false) AS is_group
    INTO c FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR c.is_group THEN
    RETURN NULL;
  END IF;
  UPDATE public.deal_followup_schedules s
     SET anchor_at = NEW.created_at,
         due_at = NEW.created_at + make_interval(secs => r.delay_seconds),
         status = 'scheduled',
         lock_until = NULL,
         attempts = 0,
         updated_at = now()
    FROM public.deals d, public.stage_followup_rules r
   WHERE s.deal_id = d.id
     AND d.organization_id = c.organization_id
     AND (d.id = c.deal_id OR (c.contact_id IS NOT NULL AND d.contact_id = c.contact_id))
     AND d.deleted_at IS NULL AND NOT coalesce(d.is_won, false) AND NOT coalesce(d.is_lost, false)
     AND r.stage_id = d.stage_id AND r.enabled
     AND s.stage_id = d.stage_id
     AND s.status IN ('scheduled', 'processing', 'done', 'failed', 'skipped')
     AND s.anchor_at < NEW.created_at;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'followup_on_inbound falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_on_inbound ON public.wa_messages;
CREATE TRIGGER trg_followup_on_inbound
  AFTER INSERT ON public.wa_messages
  FOR EACH ROW EXECUTE FUNCTION crm_internal.followup_on_inbound();

-- Regra: ligar marca o instante (piso da contagem); qualquer mudança sobe a versão.
CREATE OR REPLACE FUNCTION crm_internal.followup_rule_before()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN
    NEW.activated_at := now();
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_rule_before ON public.stage_followup_rules;
CREATE TRIGGER trg_followup_rule_before
  BEFORE INSERT OR UPDATE ON public.stage_followup_rules
  FOR EACH ROW EXECUTE FUNCTION crm_internal.followup_rule_before();

-- Regra criada, editada, desligada ou apagada: recalcula os negócios da etapa.
CREATE OR REPLACE FUNCTION crm_internal.followup_rule_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  sid uuid;
  deal record;
BEGIN
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.stage_id ELSE NEW.stage_id END;
  IF TG_OP = 'DELETE' OR NOT NEW.enabled THEN
    UPDATE public.deal_followup_schedules
       SET status = 'cancelled', lock_until = NULL, updated_at = now()
     WHERE stage_id = sid AND status IN ('scheduled', 'processing');
    RETURN NULL;
  END IF;
  FOR deal IN
    SELECT id FROM public.deals
     WHERE stage_id = sid AND deleted_at IS NULL AND NOT coalesce(is_won, false) AND NOT coalesce(is_lost, false)
  LOOP
    PERFORM crm_internal.followup_reschedule_deal(deal.id, NULL);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_rule_after ON public.stage_followup_rules;
CREATE TRIGGER trg_followup_rule_after
  AFTER INSERT OR UPDATE OR DELETE ON public.stage_followup_rules
  FOR EACH ROW EXECUTE FUNCTION crm_internal.followup_rule_after();

-- ---------------------------------------------------------------- Follow-up: fila
-- Pega os vencidos (e os presos em "processing" há mais de 5 min, se o servidor
-- caiu no meio), sem dois processos pegarem o mesmo.
CREATE OR REPLACE FUNCTION public.stage_followup_claim(p_limit integer DEFAULT 10)
RETURNS SETOF public.deal_followup_schedules
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  UPDATE public.deal_followup_schedules s
     SET status = 'processing', lock_until = now() + interval '5 minutes', attempts = s.attempts + 1, updated_at = now()
   WHERE s.deal_id IN (
     SELECT deal_id FROM public.deal_followup_schedules
      WHERE (status = 'scheduled' AND due_at <= now())
         OR (status = 'processing' AND lock_until < now())
      ORDER BY due_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
$$;
REVOKE ALL ON FUNCTION public.stage_followup_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_followup_claim(integer) TO service_role;

-- ---------------------------------------------------------------- Relógio
-- O tick do app (a cada 30 s) também acorda quando há follow-up vencido.
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'wa-agents-tick';
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(jid, command := $cmd$
      SELECT public.wa_agents_call_app('/api/wa-agents/tick', '{}'::jsonb)
      WHERE EXISTS (SELECT 1 FROM public.ai_feature_flags WHERE key = 'wa_agents_beta' AND enabled = true)
        AND (
          EXISTS (SELECT 1 FROM public.wa_bot_runs WHERE status = 'running' AND wake_at IS NOT NULL AND wake_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_bot_runs WHERE status = 'waiting_reply' AND wake_at IS NOT NULL AND wake_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_conversations WHERE ai_status = 'paused' AND ai_resume_at IS NOT NULL AND ai_resume_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_ai_agent_deal_starts WHERE status = 'pending')
          OR EXISTS (SELECT 1 FROM public.deal_followup_schedules WHERE status = 'scheduled' AND due_at <= now())
          OR EXISTS (SELECT 1 FROM public.deal_followup_schedules WHERE status = 'processing' AND lock_until < now())
        )
    $cmd$);
  END IF;
END;
$$;
