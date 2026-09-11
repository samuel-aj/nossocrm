# Staging: etapas atuais e datas do lead

Correção de 11/09/2026. Destino autorizado: branch `staging`, projeto Vercel `nossocrm`, Supabase de preview `mggvzlmquzqcloprxmoe`. Produção usa `main` e outro banco; não promover esta alteração sem aprovação.

O gráfico mantém a coorte de criação e inclui etapas anteriores até a posição atual. Um lead que volta de Assinado com Pendência para Proposta sai de Contrato e Assinado. Ganhos continuam por data de encerramento; perdas qualificadas entram até SQL e perdas desqualificadas apenas nas entradas. O histórico imutável de movimentações permanece completo.

A primeira qualificação é persistida por negócio no board. O limiar é a primeira etapa vinculada a SALES_QUALIFIED; o nome Qualificado é fallback para boards legados. Saltos sobre SQL também qualificam. Retornos preservam a primeira data; transferência para outro board usa o limiar e uma nova primeira data desse board. Datas recuperadas de eventos, atividades e webhooks conservam sua procedência. Sem data comprovada, a estimativa fica identificada no modal e não fabrica uma conversão mensal.

Um trigger cobre interface, API e atualizações diretas: entrada em ganho/perdido registra encerramento; reabertura limpa encerramento e informações antigas de perda; edições sem troca de resultado preservam o encerramento. Cada movimentação atualiza last_stage_change_date e o trigger de histórico existente registra a origem/destino. O relatório é atualizado por eventos Realtime da organização.

## Validação

- 36 testes de relatório/modal passaram, incluindo o caso de retorno da Paola, retorno anterior ao SQL, requalificação, estimativa e atualização por Realtime.
- Typecheck passou e lint dos arquivos alterados passou.
- SQL transacional em staging validou salto sobre SQL, retorno, requalificação, ganho/perda por etapa e por flags, reabertura, preservação de datas e 8 chegadas no histórico. Todos os registros do teste foram revertidos.
- Migração aplicada somente no preview: 71 datas recuperadas e 11 estimadas; zero qualificados sem data e zero encerramentos antigos em leads abertos.
- Suíte geral: 376 passaram, 5 ignorados, 7 falharam. As mesmas 7 falhas foram reproduzidas no staging original 419383d (middleware, story e cache-integrity). Lint global tem 4 erros e 2 avisos em arquivos não alterados, já presentes na base.
- Navegador conectado indisponível para inspeção visual autenticada. Validação de UI via testes de componentes; validar manualmente no preview antes de produção.

A migração está em `supabase/migrations/20260911141654_deal_lifecycle_dates.sql`. O teste de banco `supabase/tests/deal_lifecycle_dates.sql` depende exclusivamente do board DEMO do staging e deve ser envolvido em BEGIN/ROLLBACK.
