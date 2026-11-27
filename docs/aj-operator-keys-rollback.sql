-- Depois de reverter a aplicação, execute este SQL para retirar as permissões
-- do operador. Para interromper o acesso antes de reverter o código, revogue a
-- chave no painel do superadmin. Após reinstalação será necessária uma nova chave.
-- O registro privado de acessos é preservado. As chaves dos escritórios, seus
-- prompts, versões e autorizações de monitoramento não dependem deste esquema.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.aj_operator_keys IN ACCESS EXCLUSIVE MODE;
DROP FUNCTION public.aj_operator_read(uuid,text,jsonb);
DROP FUNCTION public.aj_operator_authenticate(text);
DROP FUNCTION crm_internal.aj_operator_payload(text,jsonb,uuid,uuid);
DROP FUNCTION crm_internal.aj_operator_versions(uuid,uuid);
DROP FUNCTION crm_internal.aj_operator_mask_text(text);
DROP TABLE public.aj_operator_keys;
COMMIT;
