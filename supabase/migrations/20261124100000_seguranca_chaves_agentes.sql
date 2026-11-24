-- Segurança (24/11/2026), item "dados sensíveis na interface": a chave de IA e a
-- chave de áudio de cada agente eram legíveis pelo REST para o admin da org
-- (sessão roubada = chave levada). O CRM nunca lê essas colunas pelo navegador:
-- as rotas usam a chave de serviço e devolvem só a máscara. Mesmo tratamento das
-- chaves de IA da organização (20261123120000_seguranca_parte2).
REVOKE SELECT ON public.wa_ai_agents FROM anon, authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'wa_ai_agents'
    AND column_name NOT IN ('api_key', 'audio_api_key');
  EXECUTE format('GRANT SELECT (%s) ON public.wa_ai_agents TO authenticated', cols);
END $$;
