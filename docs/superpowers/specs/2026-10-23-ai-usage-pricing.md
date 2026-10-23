# Tarifas usadas na estimativa de consumo

Consulta em 23/10/2026. Versão no registro de cada operação: `2026-10-23-standard-usd-v1`. Valores em USD, por milhão de tokens, para a API direta e serviço padrão. São estimativas por operação; não reproduzem impostos, créditos, descontos, armazenamento de cache ou a fatura do provedor.

| Modelo | Entrada | Cache lido | Saída |
|---|---:|---:|---:|
| [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) | 2,00 | 0,50 | 8,00 |
| [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) | 0,40 | 0,10 | 1,60 |
| [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o) | 2,50 | 1,25 | 10,00 |
| [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) | 0,15 | 0,075 | 0,60 |
| [GPT-5](https://developers.openai.com/api/docs/models/gpt-5) | 1,25 | 0,125 | 10,00 |
| [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini) | 0,25 | 0,025 | 2,00 |
| [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2) | 1,75 | 0,175 | 14,00 |
| [Claude Sonnet 4.5](https://platform.claude.com/docs/en/about-claude/pricing) | 3,00 | 0,30 | 15,00 |
| [Claude Haiku 4.5](https://platform.claude.com/docs/en/about-claude/pricing) | 1,00 | 0,10 | 5,00 |
| [Claude Opus 4.5](https://platform.claude.com/docs/en/about-claude/pricing) | 5,00 | 0,50 | 25,00 |
| [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/pricing) | 0,30 | 0,03 | 2,50 |
| [Gemini 2.5 Flash Lite](https://ai.google.dev/gemini-api/docs/pricing) | 0,10 | 0,01 | 0,40 |
| [Gemini 2.5 Pro, até 200 mil tokens de entrada](https://ai.google.dev/gemini-api/docs/pricing) | 1,25 | 0,125 | 10,00 |
| Gemini 2.5 Pro, acima de 200 mil | 2,50 | 0,25 | 15,00 |
| [text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small) | 0,02 | — | — |
| [gemini-embedding-001](https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/) | 0,15 | — | — |

[Whisper-1](https://developers.openai.com/api/docs/models/whisper-1): USD 0,006 por minuto, estimado pela duração informada pelo provedor. Duração de áudio permanece separada dos tokens.

Tokens em cache são parte da entrada, e tokens de raciocínio são parte da saída: ambos são contados uma única vez. A fórmula subtrai o cache da entrada comum antes de aplicar as duas tarifas.

O custo permanece indisponível para modelos/snapshots sem tarifa verificada, tiers não padrão, ferramentas cobradas pelo provedor, áudio misto Gemini sem contagens por modalidade, gravação de cache Anthropic sem TTL e contexto Anthropic 4.5 acima de 200 mil tokens. Esses casos continuam registrando o consumo real informado; indisponível não significa custo zero. Nenhuma estimativa financeira decide o bloqueio por tokens.
