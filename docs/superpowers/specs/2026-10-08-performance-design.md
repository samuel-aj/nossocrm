# Relatórios de performance confiáveis

Desenho aprovado pelo usuário ao solicitar avançar depois da revisão de 08/10/2026. Regra de ganho corrigida pelo usuário após a primeira entrega: MQL = Qualificado; ganho comercial ao promover para CUSTOMER (Cliente), assinatura no BPC; protocolo é acompanhamento posterior. Base técnica e evidências em docs/maintenance/2026-10-08-performance-review.md.

## Decisão

Aplicar a solução completa de regra, histórico e apresentação. Uma alteração apenas de rótulos manteria denominadores incompatíveis; uma alteração só na regra MQL deixaria datas e histórico incoerentes. O trabalho atual preserva o padrão visual do CRM e separa três visões, sem criar outro módulo de relatórios.

- Conversão dos leads captados (padrão): mesmo conjunto de leads criados no intervalo, marcos comprovados até o fim do intervalo ou agora, o que ocorrer primeiro. Qualificados são um subconjunto das entradas; ganhos usados no fechamento são um subconjunto dos qualificados. Mostrar os denominadores e a qualidade do histórico.
- Resultados no período: acontecimentos distintos por lead (entradas, qualificações, ganhos, perdas e reaberturas), inclusive leads anteriores. São volumes de eventos; não dividir populações diferentes como conversão.
- Carteira atual: distribuição atual dos negócios abertos, explicitamente independente do filtro de criação. Sem percentuais de conversão entre colunas.

## Dados e limites

MQL tem prioridade sobre compatibilidade com SQL/nome legado. CUSTOMER define a promoção automática a ganho em funis comerciais; wonStageId indica destino de ação manual e não substitui essa regra. Boards já CUSTOMER mantêm semântica de pós-venda/renovação, sem contar cada etapa como nova promoção. lostStageId continua definindo a perda. Chegadas em etapas posteriores podem provar o marco de qualificação segundo a regra do board; isso não inventa visita às etapas intermediárias ou opcionais. Eventos ocorridos depois do corte não entram no histórico selecionado.

O novo diário append-only deal_lifecycle_events guarda entered_board, left_board, stage_changed, qualified, won, lost, reopened, data observada, origem, identidade de board/etapa e snapshots dos campos usados no relatório. Escrita por trigger privado, leitura com RLS dos negócios visíveis. Reabertura/transferência não apagam o resultado passado. A carteira operacional continua usando o estado atual.

Recuperar o passado somente de evidência datada de etapa/marco no board correspondente. Campos estimated e atividades sem identidade de board não sustentam conversões datadas. A migração nunca deve marcar qualificações antigas como ocorridas hoje; alterações comuns de título/tag também não devem fazer isso. A cobertura incompleta e snapshots recuperados devem ser visíveis.

## Apresentação

Seleção acessível das três visões, período e data-limite explícitos, quantidade em cada barra, nomes completos/tabela acessível e detalhes que conciliam os mesmos IDs. Indicadores indisponíveis explicam por quê. Motivos de perda agrupados por chave normalizada, texto original preservado; cinco principais + Outros + Ver todos. Ganhos/perdas escritos por extenso. PDF acompanha modo, base e qualidade dos dados.

## Aceite

MQL renomeado continua válido; ganhos antigos não entram na conversão de novos leads; nenhum cenário mistura bases para produzir conversão acima de 100%; retornos não apagam chegadas reais; saltos não criam passagens fictícias; reabertura/transferência não mudam o relatório anterior; atualizações irrelevantes não criam datas; troca de configuração invalida o cache; organização/funil/etapa são consistentes inclusive em integrações privilegiadas; detalhes/PDF conciliam com os indicadores.

Implementação e testes locais autorizados. Publicação em produção será tratada após o resultado concreto e validado, conforme instruções do workspace.

## Precisão dos filtros de produto

A criação atual grava negócio e produtos em requisições separadas. Para manter os leads acessíveis pelo produto escolhido no formulário, a visão de captação filtra produto pela associação atual, explicitamente; responsável continua ancorado na entrada. Editar produtos pode mudar esse grupo filtrado, mas numerador e denominador sempre usam os mesmos IDs. Nos volumes por período o produto é o registrado no instante do acontecimento; adicionar depois não reescreve o passado. Criação atômica com itens é uma melhoria separada de persistência, registrada na revisão; não será improvisada nesta migration de relatórios.

## Correção de regra — confirmação posterior do usuário

A orientação anterior de ganho apenas em Protocolado foi revogada. No BPC atual, Assinado com Pendência está associado ao lifecycle CUSTOMER; Protocolado tem lifecycle custom Protocolo. Conta-se a primeira promoção para Cliente de cada jornada (deal+board). Avançar na região posterior à promoção preserva ganho e data; protocolo isolado não comprova assinatura nem fabrica data. Perda, regressão para antes de Cliente ou reabertura explícita encerra a jornada; uma promoção futura observada pode criar outro ganho.

Recuperação histórica deve priorizar evidência da promoção e não usar o encerramento antigo em protocolo como data da assinatura. Registros sem data comprovada permanecem sinalizados. Movimentos via UI, API e robôs usam a mesma regra, e a automação de próximo board não se repete em toda etapa posterior ao ganho.
