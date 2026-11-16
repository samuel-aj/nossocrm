# Pausa por consumo após recusa do provedor

## Problema confirmado

Em 16/11/2026, uma conversa da HW Rocha foi pausada com 73.082 tokens confirmados e 127.114 disponíveis, abaixo do limite de 300.000. A tentativa seguinte reservou 99.804 tokens e recebeu uma recusa da OpenAI por falta de créditos às 17:08 UTC (13:08 em Manaus). A execução foi registrada com erro, sem resposta ao contato.

O tratamento genérico de erro após despacho converteu essa recusa em consumo desconhecido, manteve a reserva e bloqueou a conta com `usage_unknown`. A interface não traduzia esse motivo canônico, apenas `AI_USAGE_UNKNOWN`, e omitia a reserva no banner. Não há evidência de que o teto de 300.000 tenha sido ultrapassado nesse caso.

## Correção

- Distinguir uma recusa explícita de créditos/quota da API de um timeout, erro interno ou falha ao registrar consumo.
- Registrar a recusa como `rejected`, sem inventar uma medição de zero, excluindo somente essa tentativa das reservas pendentes. A tentativa continua no histórico.
- Manter a pausa e a liberação manual, com o motivo `provider_insufficient_quota`.
- Mostrar a causa da pausa e as reservas na conversa; alinhar alertas internos e a mensagem de tentativa de retomada.
- Preservar a evidência estruturada de recusa também na geração de voz, sem guardar chave, roteiro, cabeçalhos ou corpo bruto da resposta de erro.
- Preservar consumo desconhecido como pendente. Não liberar automaticamente a conversa ou reconciliar tentativas antigas apenas pelo texto de um log.

O classificador exige erro estruturado do SDK e resposta HTTP de recusa compatível. Não trata todo HTTP 429 como falta de créditos. Referências: [códigos da OpenAI](https://developers.openai.com/api/docs/guides/error-codes) e [APICallError do SDK](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-api-call-error), confrontados com a versão instalada.

## Validação e publicação

Validação local: 589 testes em 62 arquivos passaram na suíte de agentes, consumo, interface e API; mais 7 cenários novos de voz passaram, junto com os 16 testes anteriores de voz. A suíte SQL em PGlite passou com regressões de limites, evidência de rejeição, repetição, isolamento, preservação de pendências e permissões. Typecheck, lint dos arquivos alterados, revisão independente e build final (163 páginas) também passaram.

Os testes usam provedores simulados, fetch externo proibido e PostgreSQL em memória. Nenhuma mensagem, contrato, prompt, limite ou atendimento real alterado. Migração e aplicação ainda não publicadas.

A migração deverá preceder a aplicação. Não apaga registros, redefine quotas ou retoma conversas. A recuperação do atendimento já pausado requer regularizar a conta do provedor e uma revisão explícita do responsável; esta correção não concede tokens nem resolve pendências históricas automaticamente.
