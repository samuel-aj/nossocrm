# Quoted Messages Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve received WhatsApp reply context and display it without additional chat-loading work.
**Architecture:** Normalize reply metadata during ingestion; store a bounded snapshot in existing columns. Existing message read returns that snapshot; no client fetch per quote.
**Tech Stack:** Supabase Edge Functions, TypeScript, existing Evolution/Meta providers, React/Vitest.
**Spec:** `docs/superpowers/specs/2026-09-29-header-dropdowns-quotes-design.md`

## Global Constraints

- Zero new provider calls, polling or browser/API per-message lookups when opening chat.
- Snapshot text <=300 characters. Preserve media labels and known author; don't invent missing identity.
- Lookup isolated by organization, conversation and connection. Never infer links from similar text.
- Idempotent enrichment cannot overwrite existing message body/status/edit/delete fields.
- Existing production webhook capabilities must remain. No database/RLS changes unless necessary and proven.
- No test messages or client conversation changes; exact-metadata repair of reported quote is authorized by requested correction.

## Task 1: Diagnose, preserve and render incoming quote context

**Files:** `supabase/functions/whatsapp-webhook/index.ts`, new pure quote helper/tests there; `supabase/functions/whatsapp-webhook-meta/index.ts` if equivalent isolation requires correction; `lib/whatsapp/quote.ts`, `lib/whatsapp/providers/evolution.ts`, tests. Optional focused `features/whatsapp/QuotedBlock.tsx`; coordinate its use with header implementer, who owns DealWhatsAppChat.tsx. No unrelated message routes or migrations.

**Interfaces:** Existing `QuotedSnapshot {provider_id,body,media_type,direction}` stays backward compatible; optional sender_name may carry known author. Pure extraction accepts provider event/message and returns bounded quote metadata. Use existing columns and message-list contract.

- [ ] Compare local webhook with saved deployed v27 at `../crm-header-research/deployed-index.ts`. Investigate exact HOPE message via read-only provider lookup, with credentials loaded privately (controller supplies file). Persist only sanitized fixture, no tokens or unrelated message bodies. Report proven cause separately from hypotheses.
- [ ] Write failing regression for actual provider shape plus direct/nested/wrapped context, missing original, group participant, multiple connection scope, duplicate enrichment and malicious/oversized text. Example:
```ts
expect(extractQuote(realShape).providerId).toBe('original-provider-id');
expect(extractQuote(realShape).text.length).toBeLessThanOrEqual(300);
expect(lookup.eq).toHaveBeenCalledWith('conversation_id', conversationId);
```
- [ ] Implement minimal normalizer and existing-row enrichment. Skip lookup when no quote. Reuse original when exact scoped identity resolves; otherwise snapshot provider metadata. Keep source author's name when known, distinguish unknown from contact/group title.
- [ ] Update quote display only as needed to consume optional snapshot author, preserve preview outside loaded page and handle known deleted original. Coordinate handoff with header task rather than concurrently editing DealWhatsAppChat.
- [ ] Add query-count regression demonstrating chat message read stays unchanged and ingestion performs at most existing scoped quote lookup; no provider read in hot path. Run focused tests/lint; commit only owned files.
- [ ] Report deployment file set and exact historical-repair conditions. Controller deploys after review, validates on a replay fixture isolated from live clients, and repairs only the reported record if exact metadata is available.

## Controller acceptance

- [ ] Review task and combined branch; build/test/performance with UI plan.
- [ ] Compare deployed file set to prevent overwriting staging-related or unrelated production capabilities.
- [ ] Deploy approved webhook, verify no new errors, then main frontend; preserve rollback references.
