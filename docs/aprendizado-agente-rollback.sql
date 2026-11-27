-- Dúvidas sem resposta: execute somente DEPOIS de voltar o código e encerrar
-- execuções da versão nova. Para uma volta temporária, basta voltar o código.
-- Este SQL retira as funções de registro e de revisão. Se houver dúvidas, preserva as perguntas,
-- as respostas, os vínculos e os trechos aprovados. Se a tabela estiver vazia,
-- também desfaz a estrutura exclusiva do recurso. Os arquivos do Storage ficam intactos.
-- Enquanto o código antigo estiver em uso, evite excluir, alterar os metadados ou
-- reprocessar documentos com respostas incluídas: ele recria os trechos só do arquivo.
-- Para reativar, reaplique 20261125120000_wa_ai_agent_knowledge_gaps.sql e, em seguida,
-- 20261127120000_wa_ai_review_knowledge_gap.sql antes do código novo.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.wa_ai_review_knowledge_gap(
  uuid, uuid, uuid, uuid, text, timestamptz, uuid, text, text, text, vector, text, text, integer
);
DROP FUNCTION IF EXISTS public.wa_ai_record_knowledge_gap(
  uuid, uuid, text, text, vector, text, double precision, text, text, uuid, text, uuid, boolean, integer
);

DO $rollback$
BEGIN
  IF to_regclass('public.wa_ai_agent_knowledge_gaps') IS NULL THEN
    RETURN;
  END IF;

  -- A decisão de remover a tabela vazia precisa valer até o fim da transação.
  LOCK TABLE public.wa_ai_agent_knowledge_gaps IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.wa_ai_agent_knowledge_gaps) THEN
    RAISE NOTICE 'Há dúvidas gravadas. A tabela e os vínculos com a base foram preservados.';
    RETURN;
  END IF;

  ALTER TABLE public.wa_ai_agent_chunks DROP COLUMN IF EXISTS gap_id;
  DROP TABLE public.wa_ai_agent_knowledge_gaps;
END;
$rollback$;
COMMIT;
