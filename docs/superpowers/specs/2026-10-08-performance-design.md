# Relatórios de performance confiáveis

Desenho aprovado pelo usuário ao solicitar avançar depois da revisão de 08/10/2026. Regras explicitamente confirmadas: MQL = Qualificado; BPC ganha somente em Protocolado. Base técnica e evidências em docs/maintenance/2026-10-08-performance-review.md.

## Decisão

Aplicar a solução completa de regra, histórico e apresentação. Uma alteração apenas de rótulos manteria denominadores incompatíveis; uma alteração só na regra MQL deixaria datas e histórico incoerentes. O trabalho atual preserva o padrão visual do CRM e separa três visões, sem criar outro módulo de relatórios.

- Conversão dos leads captados (padrão): mesmo conjunto de leads criados no intervalo, marcos comprovados até o fim do intervalo ou agora, o que ocorrer primeiro. Qualificados são um subconjunto das entradas; ganhos usados no fechamento são um subconjunto dos qualificados. Mostrar os denominadores e a qualidade do histórico.
- Resultados no período: acontecimentos distintos por lead (entradas, qualificações, ganhos, perdas e reaberturas), inclusive leads anteriores. São volumes de eventos; não dividir populações diferentes como conversão.
- Carteira atual: distribuição atual dos negócios abertos, explicitamente independente do filtro de criação. Sem percentuais de conversão entre colunas.

## Dados e limites

MQL tem prioridade sobre compatibilidade com SQL/nome legado. wonStageId/lostStageId explícitos continuam prevalecendo. Chegadas em etapas posteriores podem provar o marco de qualificação segundo a regra do board; isso não inventa visita às etapas intermediárias ou opcionais. Eventos ocorridos depois do corte não entram no histórico selecionado.

O novo diário append-only deal_lifecycle_events guarda entered_board, left_board, qualified, won, lost, reopened, data observada, origem, identidade de board/etapa e snapshots dos campos usados no relatório. Escrita por trigger privado, leitura com RLS dos negócios visíveis. Reabertura/transferência não apagam o resultado passado. A carteira operacional continua usando o estado atual.

Recuperar o passado somente de evidência datada de etapa/marco no board correspondente. Campos estimated e atividades sem identidade de board não sustentam conversões datadas. A migração nunca deve marcar qualificações antigas como ocorridas hoje; alterações comuns de título/tag também não devem fazer isso. A cobertura incompleta e snapshots recuperados devem ser visíveis.

## Apresentação

Seleção acessível das três visões, período e data-limite explícitos, quantidade em cada barra, nomes completos/tabela acessível e detalhes que conciliam os mesmos IDs. Indicadores indisponíveis explicam por quê. Motivos de perda agrupados por chave normalizada, texto original preservado; cinco principais + Outros + Ver todos. Ganhos/perdas escritos por extenso. PDF acompanha modo, base e qualidade dos dados.

## Aceite

MQL renomeado continua válido; ganhos antigos não entram na conversão de novos leads; nenhum cenário mistura bases para produzir conversão acima de 100%; retornos não apagam chegadas reais; saltos não criam passagens fictícias; reabertura/transferência não mudam o relatório anterior; atualizações irrelevantes não criam datas; troca de configuração invalida o cache; organização/funil/etapa são consistentes inclusive em integrações privilegiadas; detalhes/PDF conciliam com os indicadores.

Implementação e testes locais autorizados. Publicação em produção será tratada após o resultado concreto e validado, conforme instruções do workspace.
