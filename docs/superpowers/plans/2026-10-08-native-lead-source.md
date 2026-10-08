# Native Lead Source Implementation Plan

> Execution: coordinated subagents in the existing checkout, with independent review and final integrated checks. The user approved the proposal on 2026-10-08; no additional planning approval is needed.

**Goal:** Padronizar Origem do lead por negócio e mostrar sua distribuição em pizza, incluindo Não informado.

**Architecture:** `deals.lead_source` stores the native value and an initialization flag distinguishes an explicit empty value from untouched legacy data. Old `custom_fields.origem` remains preserved and is read through until the next ordinary write, avoiding a mass UPDATE that would trigger CRM automations. New event snapshots retain acquisition source; category options belong to organization preferences. UTMs remain separate.

**Tech Stack:** TypeScript, React, TanStack Query, Supabase/Postgres, SVG/Recharts, Vitest and isolated PGlite.

---

## Shared contract

`Deal.leadSource?: string | null`: absent property may resolve the legacy `customFields.origem`; explicit null means Não informado. DB rows use `lead_source` and `lead_source_initialized`. Shared helper `lib/deals/leadSource.ts` exports `normalizeLeadSource`, `getDealLeadSource`, `readDbLeadSource`, and `DEFAULT_LEAD_SOURCES`.

```ts
getDealLeadSource({ leadSource: null, customFields: { origem: 'Meta Ads' } }) === null;
getDealLeadSource({ customFields: { origem: 'Meta Ads' } }) === 'Meta Ads';
```

Native writes set the initialization flag even for null; omitted source never clears it. A changed legacy origem is accepted as an explicit integration edit when no competing native edit was supplied. Unrelated writes and UTM changes preserve established acquisition source. Conservative UTM inference is allowed only at new creation with paid/organic evidence; missing/ambiguous information remains null. Never inherit mutable contact source automatically.

## Task 1 — Storage, compatibility and history

Files: new CLI-generated migration under `supabase/migrations`, `types/types.ts`, `lib/deals/leadSource.ts`, `lib/supabase/deals.ts`, isolated SQL tests and runner.

- [x] Add native columns and org options using existing RLS boundaries; do not expose credentials or add public privileged RPCs.
- [x] Normalize explicit origem safely; preserve original custom fields and UTMs. No operational UPDATE during migration. Capture source on lifecycle event insertion and label legacy event enrichment as current evidence.
- [x] Add source audit events using existing actor-aware audit pattern; avoid recording unrelated edits as source changes.
- [x] Test explicit clear versus omission, conflicting native/legacy input, old source absorption, UTM ambiguity, contact reuse, historical snapshots, org boundaries and zero operational backfill writes.

## Task 2 — Native field and organization options

Files: `features/deals/lead/LeadPropertiesPanel.tsx`, create-deal modals, native selector/settings components, `lib/query/hooks/useOrgPreferences.ts`, `app/api/settings/org/route.ts`, `features/settings/CrmSettings.tsx`.

- [x] Add Origem do lead selector with Não informado and org options; include existing current values without silently replacing them.
- [x] Hide legacy origem only from duplicate editable custom-field controls; preserve stored definition/data and display UTMs separately.
- [x] Reuse org preferences permissions and cache for editable source categories. Defaults include Google Ads, Meta Ads, Indicação, Orgânico/Rede Social, Presencial and Outros.
- [x] Test native value selection/clearing, organization option editing and create payloads; maintain read-only permissions.

## Task 3 — Pizza and report consistency

Files: `features/reports/usePerformanceReport.ts`, `performanceHistory.ts`, `performanceMetrics.ts`, source chart/grouping component, `ReportsPage.tsx`, `reportDrilldown.ts`, PDF and report tests.

- [x] Load native current source and historical source snapshots without contact fallback.
- [x] Group the exact report entry IDs: cohort entries, period board entries, or current open deals. Each ID counts once and null contributes to Não informado.
- [x] Render accessible pizza/rosca with counts, percentages, empty state, stable colors and click/keyboard drilldown. Bound many small categories by Outros with a complete detail list.
- [x] Include the same source totals in PDF; label incomplete legacy source snapshots honestly.
- [x] Test 0/1/many categories, nulls, same lead/events dedupe, owner/product/mode filters, history unaffected by later source edits and chart/list/PDF reconciliation.

## Task 4 — APIs, import and agents

Files: public deals routes/schema/OpenAPI, integration context, deal CSV parser/import/export, copy/automation payloads and tests.

- [x] Accept/return `lead_source`, preserve omission and explicit null, retain legacy origine compatibility in DB. Contact source remains independent.
- [x] Preserve source when an existing deal is copied into another pipeline as the same acquisition. Investigation confirmed CSV import/export operates only on contacts, without deal creation; leave this separate contact flow unchanged to avoid assigning one mutable source to multiple opportunities. Imports of leads through the public API accept lead_source.
- [x] Prioritize native deal source in agent context; UTMs remain details, never automatically replace it.
- [x] Correct contact upsert omission only if touched as part of compatibility, with a focused regression.

## Task 5 — Integration and delivery

- [x] Review shared contracts, run focused Vitest and isolated SQL, scoped lint and build/typecheck.
- [x] Check the real report UI using synthetic data in the existing local preview; no production leads/messages.
- [x] Run broader suite once; compare known baseline failures. Save logs/report and a local commit.
- [x] No production migration, push or deployment in this implementation scope; retain explicit publication status.

Commands from checkout:

```powershell
npx vitest run features/reports lib/deals lib/public-api lib/query/hooks/useOrgPreferences.test.ts --reporter=dot
node scripts/test-performance-db.mjs 'C:/Users/samuk/AppData/Local/Temp/nossocrm-contact-sql/node_modules/@electric-sql/pglite/dist/index.js'
npm run build -- --webpack
```

Self-review: all approved requirements map to tasks. Unknown origin stays in denominator. No contact-level mutable source or guessed organic classification. Migration must precede frontend when publication is separately authorized.
