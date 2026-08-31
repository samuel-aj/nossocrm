-- =============================================================================
-- Intervalo entre linhas do agente: padrão passa de 1500ms para 0
-- =============================================================================
-- O tempo que o agente leva pra pensar/gerar cada linha já espaça as mensagens
-- sozinho; a pausa fixa por cima deixava o atendimento arrastado. Quem quiser
-- espaçamento agora usa o "digitando...", que dá o ritmo pelo tamanho do texto.
--
-- Só mexe no DEFAULT da coluna: agentes já criados continuam com o valor que
-- estiver salvo neles (quem quiser zerar, muda na tela do agente).
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  ALTER COLUMN line_delay_ms SET DEFAULT 0;
