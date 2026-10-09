# Conciliação de contratos no relatório

O total anterior de ganhos exigia entrada no funil e qualificação comprovadas dentro da base de conversão. Com isso, deixava de mostrar alguns contratos com ganho efetivamente registrado no mês.

## Escopo preservado

- A base continua sendo as entradas do período. Atividade de leads antigos não cria entradas.
- Qualificação, origens, perdas, reaberturas, filtros e etapas anteriores ao ganho reutilizam a população de conversão existente.
- A rosca, as colunas verticais, suas alturas e os filtros permanecem. O texto “próxima” já foi retirado anteriormente.
- Nenhuma atualização de cadastro, movimentação, configuração de etapa ou migração de banco.

## Ganhos e taxas

- Fechamentos e faturamento incluem os ganhos mantidos no cadastro atual, com encerramento registrado dentro do período e no funil selecionado, independentemente da entrada ou qualificação.
- Uma passagem histórica por uma etapa configurada como Cliente não cria um contrato no relatório. Ganhos depois perdidos ou reabertos ficam fora dos ganhos mantidos.
- Fechamentos separam ganhos da base e ganhos fora da base. Estar fora da base não comprova entrada em mês anterior; também pode faltar o registro histórico da entrada.
- Taxa de qualificação: qualificados da base / entradas.
- Taxa de fechamento: ganhos da base com qualificação comprovada antes do ganho / qualificados da base.
- Conversão total da base: ganhos da base / entradas.
- O marco de ganhos tem os mesmos registros dos fechamentos do período. As colunas posteriores mostram a posição atual desses contratos, sem inventar datas de chegada.
- A data de encerramento registrada não é apresentada como prova da data exata de assinatura.

## Validação de setembro

Conferência local com IDs anonimizados: 147 entradas, 25 qualificados, sete ganhos mantidos no período, dos quais cinco pertencem à base de entradas e dois estão fora. Taxas esperadas: 17,0%, 20,0% e 3,4%. Nenhum nome ou identificador real foi incluído nos testes versionados.

- 158 testes dos relatórios passaram em 18 arquivos.
- TypeScript completo, ESLint dos relatórios sem avisos e verificação do diff passaram após a redução final do escopo.
- Comparação independente em nove cenários confirmou igualdade dos IDs e snapshots de entradas, qualificação, perdas, origens, reaberturas, filtros e etapas anteriores ao ganho com o modo de conversão anterior.
- Navegador: mesmos sete IDs nos fechamentos e no marco de ganhos; gráficos com 549px de altura em ambos os quadros.
- Build local com webpack passou. O Turbopack local não aceita o diretório compartilhado de dependências ligado por junction; isso não altera a configuração de compilação do projeto.

Recorte confirmado pelo usuário em 09/10/2026: preservar a base de entradas e separar os ganhos do período entre os da base e os de fora. Publicação autorizada; esta nota não confirma implantação.
