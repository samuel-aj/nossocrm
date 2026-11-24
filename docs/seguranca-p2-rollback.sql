-- =============================================================================
-- Segurança parte 2 (24/11/2026): REVERSÃO
-- =============================================================================
-- O que entrou em produção:
--   * código: merge da branch fix/seguranca-p2 na main (tag do estado anterior:
--     prod-pre-seguranca-p2);
--   * banco: migrações 20261123120000_seguranca_parte2.sql e
--     20261124100000_seguranca_chaves_agentes.sql, rodadas no SQL Editor.
--
-- Como voltar atrás, conforme o problema:
--
--   A) Algo parou depois de rodar o SQL (ex.: foto de perfil, convites, webhook
--      de saída, chaves de IA): rode SÓ este arquivo no SQL Editor de produção.
--      O código novo continua funcionando sem estas regras.
--
--   B) Algo parou por causa do código (tela quebrada, erro novo): rode PRIMEIRO
--      este arquivo (o código antigo lê as chaves de IA com a sessão do usuário
--      e quebraria o chat de IA com as regras novas) e DEPOIS volte o código:
--        - mais rápido: Vercel > Deployments > deploy de produção anterior >
--          "Instant Rollback";
--        - definitivo: `git revert -m 1 <commit do merge>` e push na main.
--
-- Tudo numa transação: se qualquer linha falhar, nada muda. Não apaga dado.
-- A parte 1 (já em produção desde 23/11) NÃO é desfeita aqui.
-- =============================================================================
BEGIN;

-- 1) Chaves de IA da organização: volta a leitura completa pela sessão.
GRANT SELECT ON public.organization_settings TO authenticated;

-- 2) Convites: membros voltam a ver os convites da organização.
DROP POLICY IF EXISTS "Members can view organization invites" ON public.organization_invites;
CREATE POLICY "Members can view organization invites" ON public.organization_invites
  FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

-- 3) Fotos de perfil: regras e limites de antes.
DROP POLICY IF EXISTS avatar_upload ON storage.objects;
DROP POLICY IF EXISTS avatar_update ON storage.objects;
DROP POLICY IF EXISTS avatar_delete ON storage.objects;
CREATE POLICY avatar_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
CREATE POLICY avatar_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY avatar_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');
UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'avatars';

-- 4) Webhooks de saída: tira a recusa de endereço interno.
ALTER TABLE public.integration_outbound_endpoints DROP CONSTRAINT IF EXISTS integration_outbound_endpoints_url_public;

-- 5) Chaves dos agentes de IA: volta a leitura completa pela sessão.
GRANT SELECT ON public.wa_ai_agents TO authenticated;

COMMIT;

-- Conferência: deve voltar true, 1, true.
SELECT has_column_privilege('authenticated', 'public.organization_settings', 'ai_openai_key', 'SELECT') AS membro_le_chave,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organization_invites'
          AND policyname = 'Members can view organization invites') AS politica_convites_membros,
       has_column_privilege('authenticated', 'public.wa_ai_agents', 'api_key', 'SELECT') AS admin_le_chave_agente;
