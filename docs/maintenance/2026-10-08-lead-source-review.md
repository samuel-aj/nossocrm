# Origem dos leads — investigação e proposta

Investigação somente leitura em 08/10/2026, após a correção de Performance no commit d028772. O usuário pediu um gráfico de pizza e solicitou avaliar campo nativo versus UTMs/campos personalizados antes de definir a implementação. Nenhuma alteração de código, schema ou dados de produção nesta investigação.

## Evidências

- `contacts.source` já existe, mas é uma propriedade da pessoa, sem campo correspondente no negócio. Na MPL, todos os 1.394 contatos ativos consultados estavam sem esse valor. O tipo frontend contempla WEBSITE/LINKEDIN/REFERRAL/MANUAL, enquanto a API aceita texto livre.
- A MPL tem um campo personalizado `origem`, entidade deal, tipo select, opções Google Ads, Meta Ads, Indicação, Orgânico/Rede Social e Presencial. Os valores antigos incluem também Orgânico, que exige normalização explícita.
- Considerando todos os leads ativos, sem recorte de período: DBA tem 320 leads, 288 com origem e 32 sem origem/UTM útil; BPC Autista tem 683, 158 com origem e 525 sem origem/UTM útil. Não havia casos com somente UTM e origem vazia nesses dois funis.
- UTMs já pertencem ao negócio, em `deals.custom_fields`, com seção própria no painel. `utm_source` contém valores como Instagram_Feed, Instagram_Reels, fb e ig; `utm_medium` por vezes contém nomes de conjuntos de anúncios. Usá-los diretamente como categoria comercial fragmentaria o gráfico.
- Formulários normais e importação CSV não padronizam a origem. O contexto do agente WhatsApp atualmente prioriza utm_source sobre origem.
- O POST público de contatos faz upsert de `source` mesmo quando o campo foi omitido, convertendo omissão em null. PATCH individual preserva campos omitidos. Não usar esse campo mutável da pessoa como verdade histórica da aquisição do negócio.

## Proposta recomendada

Criar Origem do lead como campo nativo por negócio, com categorias iniciais conhecidas e opções administráveis por organização. Mostrar no cadastro e nas propriedades do lead. Um novo negócio da mesma pessoa pode ter outra origem sem reescrever negócios anteriores.

Aproveitar os valores explícitos do campo personalizado existente, com mapeamento validado e preservação do dado original. Evitar duas entradas editáveis concorrentes na interface. Manter compatibilidade com integrações que já enviam `custom_fields.origem`; a precedência e o tratamento de conflitos precisam ficar explícitos na implementação. Alterações manuais devem ser auditadas.

Preservar as UTMs como detalhes da campanha. Elas podem apoiar o preenchimento quando o conjunto de informações sustentar a categoria: por exemplo, google com medium cpc. Instagram ou Google isoladamente não provam mídia paga. Não deduzir origem pelo WhatsApp usado no atendimento, funil, responsável ou etapa. Ausência fica Não informado, sem substituir automaticamente por Orgânico ou Manual.

Pizza/rosca com quantidade, percentual e clique para conferir os leads. Usar a mesma base de IDs e filtros da visão selecionada: coorte na captação; entradas no funil nos resultados por período; negócios abertos na carteira atual. Uma fatia por lead nessa base, incluindo Não informado no denominador. Categorias menores podem aparecer em Outros, com detalhamento. PDF deve acompanhar a mesma base.

O histórico do relatório precisa registrar a origem da aquisição nos snapshots. A coluna `source` do diário lifecycle já tem outro significado (procedência da evidência), portanto não deve ser reutilizada para canal de aquisição. Não inventar snapshots antigos: indicar quando a origem veio de informação legada disponível hoje. Correções retroativas explícitas podem ser auditadas, sem atribuir a nova campanha de um contato a negócios anteriores.

## Alternativas consideradas

- Gráfico direto do campo personalizado: entrega menor, mas mantém configuração e chaves diferentes por cliente, com cobertura desigual de formulários e integrações.
- Gráfico direto de utm_source: preserva a granularidade técnica, porém mistura posicionamento, plataforma e canal comercial; não representa indicação/presencial sem convenções extras.
- Campo nativo por negócio com absorção do legado: recomendado para padronização e consistência histórica. Exige integrar cadastro, importação/API, contexto dos agentes e relatórios.

## Próximo passo

Apresentar a recomendação ao usuário. Depois de definida a abordagem, preparar implementação e testes locais sem misturar origem do contato com a do negócio. Publicação e alteração de dados reais continuam separadas da investigação.
