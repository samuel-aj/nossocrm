# Consumo e limites da IA — validação e publicação

Data: 23/10/2026. Branch: `codex/ai-consumption-controls`, base `527b39f47f1d18dca1e477179718a04cf92c2803`.

## Entrega

Implementados medição das chamadas do motor nativo WhatsApp, reserva de quota, bloqueio durável, concessão manual pelo responsável/admin e painel em **Configurações → IA e Automações → Consumo e limites**. O chat mostra consumo e liberação. Acrescentar quota preserva o histórico e não retoma a IA nem envia mensagem. Alertas internos pendentes reaparecem ao voltar ao CRM, inclusive após ficar offline.

Políticas começam em medição, sem teto numérico arbitrário. Ativar proteção exige quota explícita por conversa. Os limites por organização e de áudio são opcionais desde a correção descrita abaixo. O limite organizacional, quando configurado, usa janela móvel de 24 horas; o saldo do atendimento é acumulado. Transcrição de áudio é medida em segundos separadamente.

## Evidência de testes

| Verificação | Resultado |
|---|---|
| Vitest isolado: motor, medição, painel, API e notificações | **337 testes / 43 arquivos passaram** |
| Migração, RPCs, RLS e preservação em PGlite | **69 assertions passaram** |
| PostgreSQL 17.11 isolado, duas conexões reais | **21 verificações, 7 contenções comprovadas e 69 regressões SQL passaram** |
| TypeScript (`npm run typecheck`) | Passou |
| ESLint dos arquivos alterados e novos | Passou, zero warnings |
| Build Next.js (`npm run build`) | Passou, 155 páginas geradas |
| `git diff --check` | Passou |
| Prévia com componentes reais, API simulada | Desktop/celular sem overflow; sem pageErrors; zero requests externos |
| Concessão na prévia | Mantém atendimento humano, não envia nem retoma; botão oculto sem permissão |

Comando principal seguro:

```powershell
npx vitest run --config test/ai-usage/vitest.config.ts lib/wa-agents lib/ai-usage lib/notifications features/ai-usage app/api/ai-usage
```

A configuração proíbe fetch externo e não importa `test/setup.ts`. **Não usar o comando genérico de testes**, pois o setup antigo possui fixtures remotas.

Banco isolado:

```powershell
node scripts/test-ai-usage-db.mjs '<caminho absoluto para @electric-sql/pglite/dist/index.js>'
```

O runner não lê `.env`, não conecta a banco remoto e cria somente banco em memória. As verificações cobrem idempotência, reservas, pendências, mudança de política entre reserva/despacho, consolidação de identidades, grants, papéis e retenção de cards/contatos/mensagens.

Concorrência real:

```powershell
node scripts/test-ai-usage-concurrency.mjs '<diretório bin do PostgreSQL local>'
```

Executado com PostgreSQL 17.11 oficial, banco descartável sob `tmp/ai-usage-postgres`, senha temporária e bind exclusivo em `127.0.0.1`. No Windows, o runner aceita como segundo argumento um alias 8.3 da mesma pasta, conferido com `realpath`, para caminhos acentuados. Não instala serviço. Duas conexões distintas disputaram reservas por contato e organização, autorização de despacho, concessão idempotente, ativação antes de reserva/despacho e desativação antes de bloqueio. Cada corrida demonstrou a espera real em `pg_stat_activity`/`pg_blocking_pids`. As 69 regressões também passaram nesse PostgreSQL. O servidor foi encerrado e a senha temporária removida. Evidência privada: `tmp/ai-usage-postgres/run-GAHnpO/result.json`.

## Limites da validação

- Os ensaios de concorrência foram locais e sintéticos; não geraram carga concorrente nem dados de teste no banco de produção.
- Nenhum modelo pago, mensagem real, grupo, lead fictício em produção ou webhook externo foi acionado. Os testes usam respostas simuladas; não representam comprovação de faturamento de fornecedor.
- O lint geral encontra um warning anterior em `components/navigation/NavigationRail.tsx:39` (`no-img-element`); o arquivo não foi alterado. O build também alerta sobre um padrão amplo anterior de arquivos em `lib/installer/edgeFunctions.ts:854`; concluiu com sucesso.
- O custo é estimado em USD, com tarifas versionadas. Tarifas ou usage sem detalhe suficiente ficam indisponíveis/pendentes. Não é uma garantia monetária absoluta nem a fatura do fornecedor.
- Cobertura: motor nativo WhatsApp, auxiliares, simulador, configuração e indexação. Não inclui n8n externo, Pilot, transcrição manual nem todos os recursos internos de IA do CRM.

Prévia local: `http://127.0.0.1:4188/`. Capturas e QA privados em `tmp/ai-usage-preview/`, fora do commit. Dados da prévia são fictícios.

## Publicação autorizada

Samuel autorizou concluir a validação e publicar em 23/10/2026, mantendo os limites desativados e sem valores para ele configurar. Nenhuma mensagem real pode ser enviada como teste.

1. Concluído: conferir a branch e ensaiar concorrência com duas conexões PostgreSQL isoladas, sem mensagem/modelo real.
2. Aplicar primeiro a migração aditiva `20261023141552_ai_usage_controls.sql`. Não executar reset, truncation ou rebuild de dados comerciais.
3. Publicar a versão da aplicação que inclui os adaptadores. O código recusa operação paga se não conseguir registrar/reservar no novo banco.
4. Conferir somente consultas de painel e permissões. Manter políticas desativadas e os três limites vazios; a configuração posterior cabe a Samuel.
5. Não usar uma conversa de cliente para enviar mensagem de teste. Preservar os registros comerciais e históricos.

Recuo deve conservar tabelas de consumo, reservas, concessões e bloqueios. Uma versão anterior do motor desconhece esses bloqueios; antes de retornar a ela, interromper a execução automática de forma controlada. Preferir correção adiante, sem apagar dados ou reativar filas.

**Estado na preparação do release:** aplicação, SQL e concorrência real validados. Publicação autorizada, sem ativação de quotas. A conferência remota compara os IDs anteriores ao mesmo corte para leads, contatos, conversas e mensagens, além de políticas e triggers operacionais; não altera cadastros para testar.

## Configuração por atendimento — complemento de 23/10/2026

Após a publicação inicial, Samuel autorizou 300.000 tokens acumulados por atendimento em MPL, HW Rocha e RCA, com liberação manual e nenhum envio real de teste. Não autorizou um teto diário nem de segundos de áudio.

A migração `20261023192659_ai_usage_optional_secondary_limits.sql` remove a dependência de um teto diário para ativar proteção e interpreta quota de áudio nula como medição sem teto de segundos. Mantém limites explícitos, locks, idempotência, bloqueios e ACLs. Não altera políticas, consumo, concessões, cadastros ou mensagens. A migração inicial publicada permanece intacta. API e formulário aceitam essa mesma configuração sem preencher quotas automaticamente.

Validação adicional: **342 testes em 44 arquivos**; **94 assertions SQL** tanto em PGlite quanto PostgreSQL 17.11; **27 verificações e 9 contenções reais**. A suíte cobre consumo anterior à ativação, contas independentes sem limite global, áudio medido sem quota, quotas explícitas e ativação entre reserva e despacho. Evidência privada em `tmp/ai-usage-postgres/run-Z6zfC6/result.json`, servidor encerrado. Revisão independente confirmou alteração apenas dos condicionais de áudio nos dois RPCs.

Depois de publicar a compatibilidade, aplicar somente `enabled=true` e `conversation_tokens=300000` nas três organizações confirmadas, preservando todos os demais campos. Verificar novamente as políticas, comparando as demais organizações. Não criar concessões nem retomar conversas. O consumo acumulado já medido conta para o teto; não há reinício diário. Transcrição cobrada em segundos não integra esse limite de tokens; proteções técnicas existentes de duração e formato permanecem.
