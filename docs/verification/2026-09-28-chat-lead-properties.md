# Propriedades e notas em Chats — registro de verificação

## Baseline antes da implementação

Release `3022502`, produção, 28/09/2026. Chromium headless, 1600×1000, organização AJ, conversa de teste Maks. Dez aberturas com contexto novo e dez retornos à conversa com cache; janela de rede de 10 segundos. Mensuração espera o parágrafo de mensagem no histórico e o compositor, não a prévia na lista. Leituras no ambiente real; nenhuma mensagem enviada.

| Métrica | Primeira abertura p50 / p90 | Com cache p50 / p90 |
|---|---:|---:|
| Conversa utilizável | 3.883 / 4.364 ms | 41 / 54 ms |
| Dados transferidos | 115.575 / 115.776 bytes | 5.917 / 19.871 bytes |
| Requisições de dados | 44 / 45 | 7 / 11 |

Evidência: `evidence/2026-09-28-chat-properties-baseline.json`. Variação de abertura fria: 3.382–5.381 ms; quente: 31–65 ms. Dados incluem chamadas do CRM que ainda terminam no período de abertura e polling. Não são exclusivamente requisições do componente. Bytes são CDP encodedDataLength; recursos estáticos são separados no arquivo bruto privado, sem guardar corpos de mensagens no relatório.

### Orçamento de investigação definido antes do código

Para este caso e estas condições: p90 frio até 4.500 ms, quente até 100 ms; dados de primeira abertura até 140 KiB, reabertura até 40 KiB; até 5 leituras de dados adicionais na primeira abertura e até 2 na reabertura. O limite frio acompanha o p90 observado arredondado, e o quente admite um quadro adicional e variação de instrumentação sobre os 65 ms máximos. O acréscimo de dados acomoda a pequena página de histórico deste lead e contato/propriedades ausentes em Chats; não autoriza consultar o histórico completo ou repetir consultas globais.

Estes limites são alertas para investigar, não uma licença para aumentar custo. Comparar também p50 e distribuição. Uma regressão repetível precisa de correção mesmo abaixo do orçamento. O tamanho da página fica limitado a 50 itens; os limites em bytes deste caso não são promessa sobre notas de qualquer tamanho.

Um build local otimizado da release original foi preservado para comparação com a candidata no mesmo host. Comparar produção com servidor local isoladamente não demonstra ganho de desempenho.

### Baseline no host local otimizado

Mesma release e dados, porta 3218, 10+10 execuções: frio p50/p90 **2.414/3.009 ms**, quente **36/52 ms**. Dados: frio **199.219/210.441 bytes**, quente **12.794/93.516 bytes**; requisições de dados **44/47** e **7/12**. A hospedagem local transfere respostas maiores, sem a mesma compressão da produção. Picos quentes incluem a atualização periódica da lista de conversas (aproximadamente 80 KB local). Evidência em `evidence/2026-09-28-chat-properties-baseline-local.json`.

Para comparar no mesmo host: alerta de p90 acima de **3.100 ms** frio e **100 ms** quente; investigar diferença de bytes por endpoint, separando a atualização periódica já existente. Limites de bytes da produção não se aplicam a respostas locais com outra compressão. A candidata também terá leitura do histórico, cuja resposta será identificada separadamente.

### Conversa longa: Cintia (mesmo host local)

Dez aberturas frias e dez com cache: p50/p90 **2.884/3.379 ms** frio e **56/63 ms** quente. Dados: **319.998/323.728 bytes** frio e **92.694/173.407 bytes** quente; requisições de dados **44/47** e **8/12**. Evidência em `evidence/2026-09-28-chat-properties-baseline-cintia-local.json`. As atualizações periódicas já existentes da lista e da conversa entram na janela de 10 segundos; comparar por endpoint.

### Repetição da referência antes da candidata

Às 01:45 UTC de 29/09 (21:45 local de 28/09), a mesma release original no host local foi medida novamente, com sessão temporária nova e 10+10 execuções. Frio p50/p90 **2.380/2.507 ms**, intervalo **1.854–5.941 ms**; quente **47/49 ms**, intervalo **25–53 ms**. Dados frio **198.186/210.461 bytes**, quente **19.739/93.553 bytes**; requisições de dados **43/45** e **8/13**. A abertura isolada de 5.941 ms ocorreu também sem as alterações. Evidência em `evidence/2026-09-28-chat-properties-baseline-local-refresh.json`; manter a baseline original e este controle, sem alterar retroativamente o orçamento. A janela começa na seleção da conversa, depois de a lista estar disponível; não representa o carregamento completo do site.

## Segurança da nova leitura

Verificação autenticada da rota local com dados reais, sem mutações: lead Maicon na organização correta retorna HTTP 200 e a nota de atividade em formato legado `note`; mesmo lead em outra organização retorna 404; cursor inválido retorna 400; sem sessão retorna 401. Consulta somente leitura sob o papel autenticado da Andressa também retorna a nota esperada. Não foi necessário ampliar permissões.

## Validação funcional intermediária (build `6b77048`)

Navegador real autenticado em build otimizado, sem gravações de negócio:

- Maicon: a nota original aparece em Chats e no card, com o mesmo conteúdo e autoria. Abrir o card manteve uma única leitura de `/timeline` no total: cache válido compartilhado entre as telas.
- Selecionar a conversa recolhe o menu principal; Negócio e Contato iniciam abertos.
- Abrir/recolher propriedades preserva o mesmo elemento do compositor e seus rascunhos de mensagem e nota. As quatro seções já carregadas abriram/fecharam com zero novas leituras de propriedades/histórico.
- Notebook conserva 480 px de conversa. No celular, Escape fecha o painel e devolve foco ao botão sem perder rascunho.
- Falhas HTTP 500 simuladas por interceptação no navegador bloquearam PATCH de propriedade e POST de nota; ambos preservaram o texto. Nenhuma chamada de envio ao WhatsApp. Nenhuma gravação de negócio chegou ao servidor.
- Nenhum erro JavaScript nas verificações. A geometria do painel móvel revelou recorte de 16 px; entrou na correção final, apesar dos testes funcionais passarem.

Evidências: `evidence/2026-09-28-chat-properties-browser-preliminary.json` e `evidence/2026-09-28-chat-properties-maicon.json`. As capturas privadas contêm dados reais e não são adicionadas ao repositório.

## Testes intermediários

Build otimizado passou. Suíte completa: **881 passaram, 11 falharam, 5 ignorados**; as mesmas 11 falhas já ocorrem na referência: cache-integrity (4), middleware (1), US001 story (1) e CreateBoardModal.stages (5). Lint global: quatro erros antigos de `@ts-ignore` nos webhooks e um aviso antigo de imagem na navegação; arquivos alterados passaram lint. A revisão final encontrou paridade de edição das UTMs, largura no card, geometria móvel e seis detalhes menores; correção consolidada em andamento.

## Resultado final antes da publicação

Código revisado até `8323f26`. O ajuste final apenas reserva a altura da navegação inferior no painel sobreposto. O desktop permanece com painel de 360 px; não houve alteração de banco ou RLS nesta fase.

### Funcional e regressões

- Build otimizado de `8323f26` passou, incluindo TypeScript.
- Suíte completa final: **904 passaram, 11 falharam, 5 ignorados (920)**. As 11 falhas são as mesmas já listadas na referência; nenhuma falha nova. Lint dos arquivos alterados passou; lint global conserva os quatro erros antigos e um aviso descritos acima.
- Revisão por tarefa e revisão da alteração completa concluídas. Correções finais preservam edição e visibilidade de UTMs, ordem dos grupos, cores das etiquetas, crescimento da descrição, nome acessível do card e avisos corretos de mudança de funil.
- Modal conferido em navegador: título exato **“Deseja mudar lead de funil?”**, nome do lead e linhas De/Para. Navegar em outro funil e cancelar não tentou gravar negócio ou atividade.
- Card em 900/768 px: conversa com 818/686 px, painel esquerdo sobreposto, Escape e retorno de foco corretos, mesma instância do compositor e rascunho preservado.
- Celular 390×844: painel em x=30, largura 360 e altura 724; sem rolagem horizontal. Última seção recebe o clique acima da navegação inferior. Todos os dez testes funcionais reais passaram, incluindo erros simulados sem gravação e sem envio de WhatsApp.
- Paginação em resposta interceptada no navegador: 50 notas iniciais + 10 anteriores, duas leituras, 60 registros únicos; âncora em y=386 antes/depois, rolagem 2436 antes/depois de recolher propriedades. Nenhuma nota fictícia foi criada no banco.

Evidências finais: `evidence/2026-09-28-chat-properties-browser-final.json`, `...-board-final.json` e `...-pagination.json`.

### Tempo e volume — mesmo host, método original

Cada linha contém 10 aberturas frias e 10 com cache. p50/p90. Chromium 1600×1000, mesma organização e janela de dez segundos, mesmo programa da referência. As medições secundárias de prontidão das propriedades foram feitas em rodada separada para não adicionar um observador à comparação principal.

| Conversa / versão | Abertura fria, ms | Com cache, ms | Dados frios, bytes | Dados com cache, bytes | Requisições Fetch/XHR frias / com cache |
|---|---:|---:|---:|---:|---:|
| Maks — referência original `3022502` | 2414 / 3009 | 36 / 52 | 199219 / 210441 | 12794 / 93516 | 44 / 47 — 7 / 12 |
| Maks — repetição da referência | 2380 / 2507 | 47 / 49 | 198186 / 210461 | 19739 / 93553 | 43 / 45 — 8 / 13 |
| Maks — candidata `de393b4` | 909 / 1417 | 59 / 61 | 56904 / 64902 | 21322 / 97084 | 48 / 55 — 10 / 13 |
| Cintia — referência `3022502` | 2884 / 3379 | 56 / 63 | 319998 / 323728 | 92694 / 173407 | 44 / 47 — 8 / 12 |
| Cintia — candidata final `8323f26` | 1411 / 1422 | 69 / 74 | 134456 / 182860 | 101242 / 137837 | 47 / 55 — 10 / 13 |

O ajuste entre os dois snapshots candidatos afeta apenas o painel sobreposto acima da navegação inferior; na largura medida ele permanece acoplado. Evidências: `evidence/2026-09-28-chat-properties-release-maks-local.json` e `...-release-cintia-local.json`.

**Picos e custo adicional:** Maks teve um retorno isolado de **1337 ms**, mantido no relatório, seguido de nove retornos entre 35 e 61 ms. A referência também teve um pico frio de 5941 ms. Não se conclui desempenho constante apenas pelo p90. Cintia final variou de 1391 a 1540 ms frio e de 57 a 75 ms com cache. As reaberturas automatizadas têm pequeno custo adicional e continuam abaixo do orçamento de p90 de 100 ms.

Uma verificação adicional com dez cliques de cada versão, medidos dentro do navegador, separou a busca de elementos/IPC da automação: na Cintia, referência p50/p90 **20,6/21,7 ms** e candidata **24,5/27,3 ms** até a mensagem e o compositor terem dimensões no quadro seguinte. O acréscimo medido é **3,9/5,6 ms**. Isso mede prontidão do DOM no frame, não pintura da GPU, e não elimina a variação de rede observada. Evidência: `...-native-warm.json`.

**Requisições:** o aumento da contagem fria foi investigado. Recolher o menu revela/remonta links e dispara prefetch de navegação do Next. Na candidata, esses prefetches somaram aproximadamente 33 requisições / 24–25 KB na mediana, e zero nas reaberturas. Não há evidência suficiente para chamar segmentos de prefetch de consultas duplicadas: o registro omite query strings e cabeçalhos de segmento. As chamadas do histórico são separadas abaixo. Os alertas de contagem não foram ignorados ou redefinidos após a medição.

A redução grande dos bytes dentro da janela **não prova** que consultas globais foram eliminadas: na referência, várias terminam depois da seleção; na candidata, muitas já terminaram antes. Recursos (JS, CSS e imagens) são registrados separadamente: p50 frio aproximadamente 16 KB (Maks) e 26 KB (Cintia); com cache 0 e 10 KB, respectivamente. Conexões WebSocket não são contadas como leitura Fetch/XHR; o código reutiliza a sincronização central e não cria assinaturas por campo.

### Custo específico de propriedades e notas

- Histórico: **uma GET por abertura fria**, 3145 bytes no Maks e 1865 bytes na Cintia, neste ambiente local. Com cache, zero ou uma leitura quando a revalidação periódica de 30 segundos cai na janela.
- Resposta inicial limitada a **50 itens agregados**. O tamanho em bytes depende do texto de cada nota; os valores destes dois leads não são um limite universal.
- Abrir/fechar seções carregadas: **zero consultas adicionais**. Abrir o card a partir do chat reutilizou a página ainda válida.
- Rodada separada de prontidão (`f12edfd`, mesmo desktop): propriedades frias p50/p90 118/803 ms; com cache 47/55 ms. Resposta HTTP inicial do histórico 656/1172 ms, em paralelo com a conversa. Mede conclusão da resposta, não o instante de pintura da nota. Evidência: `...-readiness-local.json`.
- Não foi adicionada busca global de notas. Revalidação periódica consulta somente a primeira página; páginas anteriores são explícitas, com preservação da rolagem.

### Limites da coleta

A janela começa na seleção após a lista estar disponível, não no carregamento inteiro do site. Não comparar bytes locais sem compressão diretamente com produção. Totais da janela foram congelados no instante de dez segundos; nos arquivos brutos anteriores, algumas respostas que terminam depois podiam atualizar o detalhamento por endpoint, sem alterar o agregado já registrado. A coleta de produção congela também esses detalhes. Consultas de rede, cache, polling e horário real da conta variam; os números não prometem ausência de picos.

## Publicação

Publicação direta no principal autorizada por Samuel, com a versão anterior `3022502` identificada para reversão. Staging não foi utilizado. A checagem após publicação deve conferir a versão implantada, leitura da nota do Maicon, propriedades e cancelamento do modal, sem mensagens ou movimentos de teste em leads reais. O registro de implantação e a rodada de produção serão acrescentados ao relatório de entrega.

## Decisões de execução

Registro completo, em ordem, com motivos e custo de uma interpretação incorreta: [decisões de execução](2026-09-28-chat-lead-properties-decisions.md).
