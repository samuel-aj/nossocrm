# Consultas do sino

Correção de 27/11/2026. O ciclo anterior executava o feed a cada 4 segundos por aba e consultava preferências a cada 30 segundos, inclusive em segundo plano.

## Comportamento

- Feed a cada 60 segundos após conclusão, inclusive em segundo plano, para manter som e avisos no computador para quem não usa push.
- Ao abrir o sino, focar a janela ou voltar à aba, pode antecipar a atualização. Essas entradas compartilham a consulta em andamento e um intervalo mínimo de 15 segundos. Não antecipam tentativas durante o intervalo de recuperação de falhas.
- Sem rede, cancela a consulta e suspende o ciclo. Ao reconectar, retoma respeitando o intervalo mínimo.
- Timeout de 20 segundos por requisição HTTP, sem interromper a entrega local de lotes grandes. Erros de transporte e respostas com projeções incompletas usam intervalos de 60, 120, 240 e até 300 segundos. Sucesso restaura o minuto normal.
- Preferências usam o mesmo cache da aplicação por cinco minutos, sem consulta periódica. Salvar atualiza o cache, e o evento de armazenamento existente invalida as outras abas. Foco e abertura do sino atualizam preferências vencidas.
- O cursor avança apenas depois da última página. Ao retomar, a consulta recupera até 24 horas de avisos, com a janela ancorada no horário do lote. Abrir uma sessão nova mantém a regra anterior de não tocar mensagens antigas.
- Avisos recuperados com mais de dois minutos entram no histórico da sessão sem som, banner ou toast. Isso inclui alertas de consumo e de conexão ainda em andamento: continuam visíveis até a resolução, mas não voltam a interromper o usuário ao reabrir o CRM. O frescor usa o horário do servidor, não o relógio do aparelho. Datas inválidas ou futuras não disparam avisos.
- O histórico continua limitado aos 30 avisos ordinários mais recentes da sessão, além dos alertas em andamento.

## Limites e validação

O ciclo continua sendo por aba. A deduplicação entre abas protege a entrega de som, banner e toast, mas não compartilha as consultas. Os marcadores locais duram pelo menos três minutos, cobrindo a janela de apresentação de dois minutos. Sem Web Locks ou armazenamento disponível, permanece apenas o toast na aba visível, sem som/banner. Sem eventos de foco/abertura, a projeção teórica passa de até 900 feeds + 120 consultas de preferências por hora para cerca de 60 feeds e carga inicial de preferências. A redução de cerca de 94% se refere a chamadas periódicas, não ao valor total da fatura.

Nenhuma alteração de plano, configuração da Vercel, migração, prompt de agente ou envio de WhatsApp/push faz parte da correção. O servidor continua verificando organização, usuário, permissões e preferências em cada consulta.

Testes locais cobrem frequência por uma hora, rerenders, cliques/foco repetidos, ausência de rede, timeout, falhas com backoff, paginação, recuperação, avisos antigos silenciosos, mudança de organização e preservação de bloqueios em feeds incompletos. A suíte de notificações bloqueia rede real.

Antes de publicar, usar `npm run checkpoint -- sino-consumo` e conferir `origin/main`. Depois de publicado, comparar invocações dos dois endpoints com uma janela de uso semelhante. Abas já abertas podem precisar recarregar para receber o novo ciclo.
