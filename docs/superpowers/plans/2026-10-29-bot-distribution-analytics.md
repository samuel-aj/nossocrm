# Bot distribution and analytics implementation plan

> Execution: concurrent agents own disjoint modules in this session; root reviews and integrates. User approved implementation; no further execution-mode approval required. No production changes or real sends.

**Goal:** distribute leads through configurable branches and measure robot, block, edge and objective performance.

**Architecture:** immutable run snapshots for newly instrumented runs; service-only atomic allocation/events; database aggregation over an initiation cohort; authenticated organization-scoped API; canvas and statistics panel sharing one response.

**Tech Stack:** Next.js, TypeScript, Zod, React Flow, TanStack Query, Supabase/PostgreSQL, Vitest and isolated PGlite.

## 1. Engine and database (bot_engine_ab)
- [x] Add `split` to lib/wa-agents/types.ts: `{mode:'round_robin'|'random',branches:[{id,label,weight,goto_step_id}]}` with 2..20 stable unique branches and random total100.
- [x] Add additive snapshot/event/assignment/counter migration. RPC `wa_bot_record_event(p_org,p_run,p_step,p_kind,p_output,p_target)` deduplicates first events. `wa_bot_allocate_branch(p_org,p_run,p_step)` locks allocator and persists route.
- [x] Instrument lib/wa-agents/bots.ts entry, exit, waits/replies/timeouts, failed/skipped paths; snapshot definitions and safe webhook credential resolution. Propagate test flag through chained robots.
- [x] Test distribution across distinct subjects, same-subject repeat, race/idempotence, weighted selection, snapshots, terminal states and failures in motor/isolated SQL.

## 2. Editor (bot_split_editor)
- [x] Add palette/type, properties, named outputs and connections in features/wa-agents/canvas.
- [x] Extend serialization, copying, deletion/remapping and graph validation; update app/api/wa-agents/_shared.ts and lib/wa-agents/botTemplates.ts references.
- [x] Verify four branches roundtrip, disconnected activation failure, invalid weights and duplicate identifiers; existing blocks remain compatible.

## 3. Aggregation and API (root)
- [x] New lib/wa-agents/botAnalytics.ts maps database aggregates and snapshot labels to typed response. No raw secrets or conversation text in response.
- [x] New SQL aggregate function reads all matching executions/events without API 100-row cap. Service-only execution, organization/bot predicate on every group. First-exit denominators, group unions and unique-subject objectives after split.
- [x] Add GET app/api/wa-agents/bots/[id]/analytics/route.ts with admin guard, UUID/date/revision validation, no-store response, absent/foreign bot404 and database errors explicit.
- [x] Exclude is_test runs and mark editor/list Testar entrypoints; omit snapshots from bot-runs list API.
- [x] Test organization guard, period validation, no-data/legacy, complete counts beyond100, converging edges, repeats and goal ordering.

## 4. Metrics UI (bot_analytics_ui)
- [x] Add analytics mode, shared period selector, revision selector, objective comparison and statistics table to editor. List button opens statistics.
- [x] Query response contract: summary, steps/outputs, groups, variants, revisions, selectedRevision/isCurrentRevision, legacyRuns/measurementStartedAt, goalOptions. Labels show denominators.
- [x] Context supplies overlay to blocks/edges. Hide when dirty or mismatched revision; all loading/empty/error states explicit.
- [x] Fake API tests for period/goal/revision filters, percentages, empty states and overlay suppression.

## 5. Integration
- [x] Run explicit offline tests using `npx vitest run --config test/ai-usage/vitest.config.ts <changed and regression files>`; no generic remote fixtures.
- [x] Run isolated SQL scripts with local PGlite, zero production connection.
- [x] Run `npx tsc --noEmit`, targeted ESLint and `npm run build`; review diff and test evidence.
- [x] Record docs/results and commit reviewed feature. Report local completion and publication still pending.
