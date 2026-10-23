# Consumo e limites da IA — validação local

Data: 23/10/2026. Branch: `codex/ai-consumption-controls`, base `527b39f47f1d18dca1e477179718a04cf92c2803`.

## Entrega

Implementados medição das chamadas do motor nativo WhatsApp, reserva de quota, bloqueio durável, concessão manual pelo responsável/admin e painel em **Configurações → IA e Automações → Consumo e limites**. O chat mostra consumo e liberação. Acrescentar quota preserva o histórico e não retoma a IA nem envia mensagem. Alertas internos pendentes reaparecem ao voltar ao CRM, inclusive após ficar offline.

Políticas começam em medição, sem teto numérico arbitrário. Ativar proteção exige quotas explícitas por conversa e por organização. O limite organizacional usa janela móvel de 24 horas; o saldo do atendimento é acumulado. Áudio tem quota em segundos separada.

## Evidência de testes

| Verificação | Resultado |
|---|---|
| Vitest isolado: motor, medição, painel, API e notificações | **333 testes / 43 arquivos passaram** |
| Migração, RPCs, RLS e preservação em PGlite | **65 assertions passaram** |
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

## Limites da validação

- Não havia servidor PostgreSQL ou daemon Docker disponível. As sequências transacionais foram testadas em PGlite; os bloqueios de linha foram revisados, mas **não houve corrida em duas conexões PostgreSQL reais**. Esse ensaio permanece antes do piloto protegido.
- Nenhum modelo pago, mensagem real, grupo, lead fictício em produção ou webhook externo foi acionado. Os testes usam respostas simuladas; não representam comprovação de faturamento de fornecedor.
- O lint geral encontra um warning anterior em `components/navigation/NavigationRail.tsx:39` (`no-img-element`); o arquivo não foi alterado. O build também alerta sobre um padrão amplo anterior de arquivos em `lib/installer/edgeFunctions.ts:854`; concluiu com sucesso.
- O custo é estimado em USD, com tarifas versionadas. Tarifas ou usage sem detalhe suficiente ficam indisponíveis/pendentes. Não é uma garantia monetária absoluta nem a fatura do fornecedor.
- Cobertura: motor nativo WhatsApp, auxiliares, simulador, configuração e indexação. Não inclui n8n externo, Pilot, transcrição manual nem todos os recursos internos de IA do CRM.

Prévia local: `http://127.0.0.1:4188/`. Capturas e QA privados em `tmp/ai-usage-preview/`, fora do commit. Dados da prévia são fictícios.

## Publicação posterior

1. Conferir a branch e ensaiar concorrência com duas conexões PostgreSQL isoladas; nenhuma mensagem/modelo real é necessária.
2. Aplicar primeiro a migração aditiva `20261023141552_ai_usage_controls.sql`. Não executar reset, truncation ou rebuild de dados comerciais.
3. Publicar a versão da aplicação que inclui os adaptadores. O código recusa operação paga se não conseguir registrar/reservar no novo banco.
4. Conferir somente consultas de painel e permissões; escolher quotas explícitas para uma organização piloto antes de ativar proteção.
5. Não usar uma conversa de cliente para enviar mensagem de teste. Preservar os registros comerciais e históricos.

Recuo deve conservar tabelas de consumo, reservas, concessões e bloqueios. Uma versão anterior do motor desconhece esses bloqueios; antes de retornar a ela, interromper a execução automática de forma controlada. Preferir correção adiante, sem apagar dados ou reativar filas.

**Estado final desta entrega:** implementação local validada. Sem publicação, migração remota ou quotas ativadas.
