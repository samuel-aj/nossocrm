# Distribuição de caminhos e estatísticas dos robôs

Desenho aprovado por Samuel em 29/10/2026 na conversa. Implementação local autorizada; publicação e migração de produção ainda não solicitadas. Nenhuma mensagem real nos testes.

## Comportamento
- Bloco Distribuir caminhos com 2 a 20 saídas nomeadas e IDs estáveis. Dois modos: alternado A/B/C/... (round robin) e aleatório com pesos inteiros positivos somando 100%.
- Escolha persistida por organização, robô, versão do experimento, bloco e lead (contato/conversa como reserva). Reprocessamentos ou novo acionamento do mesmo lead no teste preservam o caminho.
- Distribuição atômica no banco, sem contador local por processo. Falha ao alocar interrompe antes de acionar o caminho.
- Saída com ligação configurável no canvas; bloco ramificado deve ser o último do balão. Importação/exportação e duplicação preservam a estrutura e remapeiam destinos.

## Medição
- Filtro reúne execuções iniciadas no período e acompanha sua evolução até a consulta. O mesmo grupo serve de denominador para todos os números; períodos locais inclusive Esta semana/Semana passada.
- Resumo: acionamentos, pessoas/leads distintos, em andamento, aguardando, concluídos, com erro e cancelados. Concluído não significa objetivo comercial atingido.
- Cada bloco: execuções distintas que chegaram / total iniciado. Cada saída: primeiras saídas resolvidas / execuções que chegaram ao bloco. Esperas, falhas e ações puladas visíveis.
- Loops/retries não inflam o indicador principal. Balões agrupam execuções distintas, nunca somam os blocos internos. Saídas diferentes com mesmo destino mantêm contadores independentes.
- Comparação A/B/C/...: escolher um bloco objetivo; pessoas atribuídas a cada alternativa e que chegaram ao objetivo após a escolha na mesma execução / pessoas atribuídas. Repetições não ampliam o denominador.
- Estatísticas diretamente no fluxo salvo, além de painel e tabela. Versão histórica ou rascunho não salvo oculta sobreposição no canvas para evitar associar números ao desenho errado.

## Persistência e compatibilidade
- Novas execuções recebem snapshot/revisão do fluxo, sem segredos de webhook; execuções legadas permanecem com seu comportamento e histórico existentes. Mudança de mensagens/saídas/pesos cria outra revisão; mover balão não cria revisão.
- Snapshot define os passos das novas execuções. Robô desligado ainda cancela processamento. Credencial de webhook atual só pode ser aplicada ao mesmo ID e mesma URL; mudança incompatível falha explicitamente.
- Eventos estruturados e idempotentes por execução/bloco/tipo; entrada, saída, falha e pulo. Apenas service_role grava; consultas administrativas são sempre restritas à organização.
- Histórico legado permanece acessível, mas sem taxas por bloco reconstruídas a partir das notas incompletas. Testes sinalizados ficam fora das estatísticas e da distribuição real.
- Migrações aditivas, sem apagar leads, conversas, mensagens ou logs.

## Validação
Motor simulado, SQL PostgreSQL isolado, serialização e UI com respostas fictícias. Cobrir concorrência, reprocessamento, resposta/timeout, loops, divisão em quatro saídas, pesos, metas após distribuição, agrupamentos, destinos iguais, revisões, limites de período, isolamento entre organizações, segredo e exclusão dos testes. Typecheck, lint e build ao integrar.
