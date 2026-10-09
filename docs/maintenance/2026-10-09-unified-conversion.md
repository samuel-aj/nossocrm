# Conversão consistente no relatório de Performance

## Problema

O relatório publicado usava acontecimentos do período nos indicadores e entradas do período no gráfico. No BPC Autista de setembro, isso mostrava 29 qualificados e 5 ganhos nos cartões, mas 25 e 7 no gráfico. As taxas também tinham sido substituídas por contagens. Além da diferença de população, a posição em Protocolado estava sendo usada para preencher o marco Cliente sem prova de ganho.

## Regra aplicada

O modo interno `conversion`, usado pela tela sem seletor de modos, acompanha os mesmos leads com entrada registrada no funil dentro do período até o fim do intervalo. Responsável, produto e origem são os da entrada selecionada. Leads captados antes podem participar se a entrada neste funil ocorreu no período; acontecimentos de entradas anteriores não entram nesta base.

- E: entradas distintas no funil.
- Q: leads dessa base com qualificação comprovada. Uma qualificação anterior à entrada exige confirmação na jornada selecionada e conserva sua data original.
- W: ganhos comprovados desses qualificados, com qualificação confirmada antes do ganho.
- Taxa de qualificação: Q/E. Fechamento: W/Q. Conversão total: W/E.
- As colunas MQL e Cliente usam exatamente os IDs de Q e W. Etapas intermediárias mostram avanço acumulado, limitado pelos marcos comprovados. Uma etapa posterior não cria qualificação ou ganho.
- Pós-venda exige ganho elegível no mesmo episódio: reabertura, perda, saída do funil ou retorno a uma etapa anterior a Cliente encerram a autorização desse episódio.
- Cada percentual abaixo de uma coluna é a quantidade da próxima dividida pela atual; denominador zero e a última coluna não exibem percentual.
- Ganhos sem qualificação anterior, evidências contraditórias e entradas sem etapa ficam acessíveis na conferência, com os registros originais preservados. Entradas sem etapa não ganham uma etapa inventada.

Cartões, origem, etapas, listas e PDF usam a mesma base. O detalhe de Fechamentos mostra também a base e fórmula da conversão total. Colunas verticais e alturas iguais foram mantidas. Modos legados continuam disponíveis no motor para seus consumidores e testes.

## Verificação dos registros de setembro

Extração somente leitura, com IDs anonimizados e dados pessoais/valores/origens omitidos nos arquivos locais ignorados. A verificação independente encontrou:

- 147 entradas, 25 qualificados e 4 ganhos elegíveis.
- Taxas de 17,0068%, 16% e 2,7211%.
- Colunas: 147, 141, 79, 36, 25, 25, 8, 4, 4.
- Três protocolos não tinham promoção a Cliente comprovada no episódio.
- Uma qualificação importada coincidiu com passagem direta de etapa anterior ao MQL para Perdido. Um trigger legado havia preenchido `qualified_at` pela classificação da perda. A data contraditória é desconsiderada no relatório; prova posterior conserva a data posterior e não legitima retroativamente aquela data.

Não há migração, alteração de leads ou reescrita de histórico nesta correção.

## Validação

Testes cobrem igualdade de IDs entre cartões, colunas e detalhes; denominadores e PDF; saltos; base antiga; datas contraditórias e provas posteriores; ganhos antes da qualificação; reabertura; filtro por entrada; entradas sem etapa e encerramentos explícitos em funis de clientes. Prévia local usando a extração anonimizada confirmou 25 IDs idênticos no cartão/MQL e 4 no cartão/Cliente, taxas e diagnósticos. Alturas dos quadros: 564px/564px no desktop e 628px/628px em 390px.

A aprovação de publicação inclui teste completo do módulo, TypeScript, lint dos arquivos alterados e build remoto antes do merge.
