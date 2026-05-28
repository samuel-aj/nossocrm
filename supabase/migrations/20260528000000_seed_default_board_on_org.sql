-- Auto-seed default "Pipeline de Vendas" board for every new organization.
-- Resolve the n8n→CRM 422 ("Provide board_id or board_key") on fresh installs.

CREATE OR REPLACE FUNCTION public.seed_default_board(p_org_id uuid)
RETURNS uuid AS $$
DECLARE
    v_board_id uuid;
    v_won_id uuid;
    v_lost_id uuid;
BEGIN
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'seed_default_board requires p_org_id';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.boards
        WHERE organization_id = p_org_id
          AND key = 'pipeline-de-vendas'
          AND deleted_at IS NULL
    ) THEN
        SELECT id INTO v_board_id
        FROM public.boards
        WHERE organization_id = p_org_id
          AND key = 'pipeline-de-vendas'
          AND deleted_at IS NULL
        LIMIT 1;
        RETURN v_board_id;
    END IF;

    INSERT INTO public.boards (
        organization_id, key, name, description, type, template,
        linked_lifecycle_stage, is_default, position,
        goal_description, goal_kpi, goal_target_value, goal_type,
        agent_name, agent_role, agent_behavior, entry_trigger
    ) VALUES (
        p_org_id,
        'pipeline-de-vendas',
        'Pipeline de Vendas',
        'MQL até fechamento ou perda',
        'SALES',
        'SALES',
        'MQL',
        true,
        0,
        'Maximizar a receita recorrente mensal (MRR).',
        'Receita Nova (MRR)',
        '50000',
        'currency',
        'Closer Bot',
        'Executivo de Vendas',
        'Atue como um consultor experiente. Foque em entender a dor do cliente, apresentar a solução de valor e negociar termos. Use gatilhos mentais de urgência e escassez quando apropriado.',
        'Leads qualificados (MQL) vindos da Pré-venda.'
    )
    RETURNING id INTO v_board_id;

    INSERT INTO public.board_stages (board_id, organization_id, name, label, color, "order", is_default, linked_lifecycle_stage)
    VALUES
        (v_board_id, p_org_id, 'Descoberta', 'Descoberta', 'bg-blue-500',   0, true,  'MQL'),
        (v_board_id, p_org_id, 'Proposta',   'Proposta',   'bg-purple-500', 1, false, 'PROSPECT'),
        (v_board_id, p_org_id, 'Negociação', 'Negociação', 'bg-orange-500', 2, false, 'PROSPECT'),
        (v_board_id, p_org_id, 'Ganho',      'Ganho',      'bg-green-500',  3, false, 'CUSTOMER'),
        (v_board_id, p_org_id, 'Perdido',    'Perdido',    'bg-red-500',    4, false, 'OTHER');

    SELECT id INTO v_won_id  FROM public.board_stages WHERE board_id = v_board_id AND label = 'Ganho'   LIMIT 1;
    SELECT id INTO v_lost_id FROM public.board_stages WHERE board_id = v_board_id AND label = 'Perdido' LIMIT 1;

    UPDATE public.boards
       SET won_stage_id = v_won_id,
           lost_stage_id = v_lost_id,
           updated_at = NOW()
     WHERE id = v_board_id;

    RETURN v_board_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Extend handle_new_organization trigger to also seed the default board.
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.organization_settings (organization_id)
    VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;

    PERFORM public.seed_default_board(NEW.id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill: seed for existing organizations that don't have any active board yet.
DO $$
DECLARE
    org RECORD;
BEGIN
    FOR org IN
        SELECT o.id
        FROM public.organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM public.boards b
            WHERE b.organization_id = o.id
              AND b.deleted_at IS NULL
        )
    LOOP
        PERFORM public.seed_default_board(org.id);
    END LOOP;
END $$;
