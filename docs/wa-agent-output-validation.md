# Validação das respostas dos agentes de WhatsApp

Correção de 02/10/2026, na branch `fix/wa-agent-output`.

## Problema

O motor enviava o texto dos passos da IA diretamente ao WhatsApp. Isso permitia
enviar envelopes internos como `{"dados":{...}}` e concatenar a mesma pergunta
escrita antes e depois de uma ferramenta. Instruções no prompt não impediam esses
casos. Os testes de regressão reproduziram os dois problemas no código anterior.

## Comportamento

1. Toda a resposta é preparada antes do primeiro envio, incluindo legendas.
   Envelopes conhecidos de memória, chamadas de ferramenta escritas como texto e
   marcadores internos impedem a liberação do rascunho inteiro.
2. Se houver conteúdo interno, o motor tenta reescrever apenas os trechos
   inválidos, uma vez. A chamada usa saída estruturada, não recebe ferramentas,
   não faz retentativas e tem limite de 15 segundos. Os trechos corrigidos passam
   pela mesma validação, preservando a posição das mídias.
3. Se a recuperação falhar, nenhuma mensagem ou mídia do rascunho é enviada e as
   ações solicitadas nessa geração não são aplicadas. A conversa fica pausada,
   sem retomada agendada, e a execução registra `AI_OUTPUT_BLOCKED`. O webhook de
   erro existente é disparado quando estiver configurado. Uma intervenção humana
   ou transferência ocorrida durante a geração é preservada.
4. Linhas iguais dentro da mesma resposta são enviadas uma única vez, incluindo
   repetições entre passos. Espaços são normalizados; diferenças de valores,
   acentos, caixa e pontuação são preservadas. O tratamento existente de texto
   repetido na legenda também é mantido.
5. Envelopes internos enviados anteriormente pelo agente deixam de entrar no
   histórico usado pela IA. As mensagens originais continuam no CRM; textos do
   cliente e de atendentes humanos não são removidos.
6. O simulador usa a mesma geração e validação. O evento `output_checked` registra
   resultado, motivo, posição do trecho, tentativa de recuperação e quantidade
   de linhas removidas. Registra também os nomes das ferramentas e o tamanho do
   texto de cada passo, sem copiar o rascunho interno para esse evento.

Não há migração de banco, nova configuração ou alteração do roteiro cadastrado.
Após revisar uma falha, a equipe pode retomar o agente pelo controle existente da
conversa. A mensagem pendente permanece disponível para essa retomada.

## Verificação

Testes automatizados cobrem os casos dos relatos, texto anterior a uma ferramenta
sem resposta final, legendas inválidas, recuperação incompleta ou com erro,
preservação das ações originais, encerramento sem texto, histórico e intervenção
humana. Os testes do motor usam banco, WhatsApp e ações simulados. Três testes
usam o AI SDK instalado e ferramentas reais, com transporte do modelo simulado,
para verificar o ciclo de ferramentas e o parsing da recuperação estruturada.

Comandos:

```sh
npx vitest run lib/wa-agents --reporter=dot
npm run typecheck
npm run build -- --webpack
```

Resultado: 230 testes passaram em 30 arquivos, e a checagem de tipos passou.
O lint passou nos arquivos alterados com limite de zero avisos. O build
local não usa credenciais do Supabase; ele valida a compilação, não autenticação
ou atendimento real. Nenhuma mensagem foi enviada a clientes na validação.

## Limites

- A deduplicação cobre linhas iguais na mesma resposta. Perguntas reformuladas
  ou repetidas em atendimentos posteriores dependem do histórico e do roteiro.
- O detector reconhece formatos internos conhecidos; não é um classificador
  semântico de qualquer informação que o modelo possa escrever.
- Falhas parciais de envio e perda de trava entre execuções continuam sendo
  assuntos separados. Esta alteração não implementa uma fila de saída com
  idempotência.
- A publicação em produção é uma etapa posterior à revisão desta branch.
