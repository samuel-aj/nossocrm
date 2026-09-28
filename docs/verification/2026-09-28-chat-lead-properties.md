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

## Execução

Implementação e validação em andamento. Resultados da candidata e publicação serão registrados após a execução; os números acima não descrevem a nova versão.
