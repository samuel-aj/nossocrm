# Calendário proativo e agente por etapa — execução

**Goal:** configurar horário de contatos proativos sem limitar respostas ao cliente e permitir agente direto na etapa.
**Architecture:** calendário por organização com API administrativa; decisão temporal pura; guardas nos workers e contexto persistente de robôs. Migração aditiva, sem alteração de credenciais/cadastros.
**Stack:** Next.js, TypeScript, Zod, Supabase/Postgres, Vitest.

Execução inline autorizada por Samuel; spec aprovada na conversa e registrada em ../specs/2026-11-05-followup-calendar-design.md. Não publicar nem testar mensagens reais nesta etapa.

- [x] Identificar base main2193874 e preservar acesso ZapSign Mestre.
- [x] Calcular e testar próxima abertura com fuso, faixas e fim de semana.
- [x] Criar migração de followup_calendars e agent_id/instruction na regra da etapa, com escrita somente service_role.
- [x] Criar calendar server/API GET/PUT: guardRoute(admin), validação Zod, organização da sessão, erro de leitura bloqueia execução.
- [x] Tela Horários de follow-up: ativação explícita, fuso, dias e múltiplas faixas, salvar e consultar erros.
- [x] Integrar régua IA antes de consumir regra, etapa com resultado deferred e bots com marcador proativo persistente; herdar nos filhos e limpar após resposta.
- [x] Integrar agente de etapa: verificar beta, agente da organização, orçamento, pausa/parada/aprovação, conversa válida; preservar estado e número.
- [x] Testar workers e permissões com mocks; validar SQL localmente sem banco de produção.
- [x] Rodar testes focados/regressões, typecheck, lint focado e build. Revisar diff, registrar limitações e commit local.

Quando houver adiamento, a tentativa não é concluída nem contada como falha. Ao reabrir, revalidar a referência de silêncio antes de enviar. Robôs receptivos não recebem restrição. Nenhum caminho pode retomar uma IA bloqueada por consumo automaticamente.


## Validação em 05/11/2026

115 testes focados/regressões aprovados (9 arquivos; rodada de 113 + dois casos adicionais de worker e robô filho). Typecheck, lint focado e build webpack aprovados; 162 páginas geradas. SQL executado em PostgreSQL PGlite em memória, conferindo migração, isolamento, claim único, preservação de memória, pausa/resposta/robô concorrente, grants e RLS. Nenhuma conexão de produção nem envio real.

## Publicação e limites

- Aplicar a migração 20261105180000_followup_calendar antes de publicar o código; o código falha fechado se a tabela não estiver disponível. Não aplicar nesta implementação local.
- Calendário começa desligado; cada organização configura e ativa explicitamente.
- Com calendário ativo, regras da régua IA vencidas durante a pausa são consolidadas na mais recente; sem calendário, a ordem anterior é preservada.
- Robôs iniciados por follow-up depois desta versão recebem o marcador proativo. Execuções antigas já em andamento não são reclassificadas por inferência.
- Se o horário terminar após uma parte da resposta já ter sido enviada, o restante é interrompido sem repetir o trecho na abertura seguinte. Se nenhum envio ocorreu, a tentativa volta a aguardar.
- SQL validado sobre estrutura mínima local; revisar estado da migração no banco antes de qualquer publicação.
- Retorno agendado, CTWA, ZapSign autônoma e voz continuam no roteiro das próximas entregas.
