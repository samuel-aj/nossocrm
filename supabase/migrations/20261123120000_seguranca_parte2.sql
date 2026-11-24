-- Segurança parte 2 (auditoria de 23/11/2026). Não apaga dado.

-- A) Chaves de IA da organização: qualquer membro (até vendedor) lia em texto
--    puro pelo navegador. Agora a sessão do usuário lê todas as colunas MENOS as
--    chaves; o servidor do CRM lê as chaves com a chave de serviço, depois de
--    conferir a organização.
REVOKE SELECT ON public.organization_settings FROM anon, authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'organization_settings'
    AND column_name NOT IN ('ai_openai_key', 'ai_google_key', 'ai_anthropic_key');
  EXECUTE format('GRANT SELECT (%s) ON public.organization_settings TO authenticated', cols);
END $$;

-- B) Convites: qualquer membro lia o link dos convites pendentes (inclusive de
--    admin). Continuam vendo os convites só admin e quem gerencia a equipe.
DROP POLICY IF EXISTS "Members can view organization invites" ON public.organization_invites;

-- C) Fotos de perfil: qualquer usuário de qualquer escritório trocava ou apagava
--    a foto de outro, e o bucket aceitava qualquer arquivo. Agora cada um mexe só
--    na própria foto (avatars/<id do usuário>.<extensão>), até 2 MB e só imagem.
DROP POLICY IF EXISTS avatar_upload ON storage.objects;
DROP POLICY IF EXISTS avatar_update ON storage.objects;
DROP POLICY IF EXISTS avatar_delete ON storage.objects;
CREATE POLICY avatar_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.(png|jpe?g|webp|gif)$'));
CREATE POLICY avatar_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.(png|jpe?g|webp|gif)$'))
  WITH CHECK (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.(png|jpe?g|webp|gif)$'));
CREATE POLICY avatar_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.(png|jpe?g|webp|gif)$'));
UPDATE storage.buckets
SET file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
WHERE id = 'avatars';

-- D) Webhooks de saída: a URL é gravada pelo navegador e o banco faz a primeira
--    entrega (pg_net). Endereço interno (localhost, rede privada, metadados da
--    nuvem, IP em decimal/hexa, IPv6 literal) passa a ser recusado na gravação.
ALTER TABLE public.integration_outbound_endpoints
  DROP CONSTRAINT IF EXISTS integration_outbound_endpoints_url_public;
ALTER TABLE public.integration_outbound_endpoints
  ADD CONSTRAINT integration_outbound_endpoints_url_public CHECK (
    url ~* '^https?://'
    AND url !~* '^https?://([^/]*@)?(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|\[|0x|[0-9]+(:|/|$)|[^/:]*\.(internal|local|localhost)(:|/|$))'
  );
