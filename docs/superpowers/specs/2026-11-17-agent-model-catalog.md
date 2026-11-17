# Modelos disponíveis no editor de agentes

Pedido: apresentar Luna, Terra e Astra em **Modelo e resposta**, sem exigir o preenchimento manual do ID. Sol também integra a família atual.

## Catálogo verificado em 17/11/2026

| Opção | ID da API | Documentação |
| --- | --- | --- |
| GPT-6 Luna | `gpt-6-luna` | https://developers.openai.com/api/docs/models/gpt-6-luna |
| GPT-6.1 Terra | `gpt-6.1-terra` | https://developers.openai.com/api/docs/models/gpt-6.1-terra |
| GPT-6.1 Sol | `gpt-6.1-sol` | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| GPT-6 Astra | `gpt-6-astra` | https://developers.openai.com/api/docs/models/gpt-6-astra |

GPT-4.1 permanece como padrão; as opções anteriores e “Outro” permanecem disponíveis. Não há migração nem alteração dos agentes salvos, prompts, limites ou retomadas manuais. A chave configurada continua determinando o acesso à API.

## Compatibilidade

- Responses API para chamadas de ferramentas. O SDK instalado precisa de `forceReasoning` para reconhecer os novos IDs; o adaptador interno aplica essa opção depois da política de consumo, inclusive sem limite ativo.
- Temperatura e top-p omitidos nesses modelos; o editor indica temperatura automática, preservando o valor salvo para outros modelos. Não há alteração do esforço de raciocínio.
- Somente os quatro IDs verificados são adicionados à reserva segura. Limite de saída, liquidação dos tokens, bloqueio por orçamento e retomada manual permanecem.
- Tarifas separadas e versionadas, incluindo contexto acima de 272 mil tokens. Custo permanece indisponível quando o SDK não informa os dados necessários de cache; a contagem de tokens continua funcionando.

Referência de parâmetros: https://developers.openai.com/api/docs/guides/latest-model#migration-quickstart

## Verificação

Testes isolados com transporte interceptado e rede bloqueada, incluindo ferramentas, consumo e recusa por limite. Não enviar mensagens, criar contratos, trocar modelos ou executar prompts em produção durante a validação.

Resultado local: 106 testes distintos aprovados (25 novos de compatibilidade e 81 relacionados a consumo, preços, revisão de respostas e mídia), lint dos arquivos alterados, typecheck e build Next.js com 163 páginas aprovados. Revisão independente sem problemas identificados. Nenhuma publicação ou migração nesta etapa.
