# WhatsApp Group Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular grupos a vários contatos/leads e fornecer o ID externo do grupo principal em webhooks somente com o recurso ativo.

**Architecture:** Registro canônico de grupos por organização/provedor/JID e tabelas de vínculos separadas dos campos comerciais existentes. APIs autenticadas encapsulam permissões e alterações pontuais; componentes isolados integram as telas. Um helper de servidor e seu equivalente SQL aplicam o contrato do campo aos emissores de webhooks.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, Supabase/Postgres, Vitest; sem dependências novas.

**Spec:** docs/superpowers/specs/2026-10-01-whatsapp-group-links-design.md

## Global Constraints

- Chats mantém entradas separadas para grupos e conversas privadas.
- A configuração `wa_group_links_enabled` é por organização e começa desativada.
- Campo padrão `deal.whatsapp_group_id`; variável `{{deal.whatsapp_group_id}}`. Ativo e sem principal: null. Inativo: chave omitida.
- Todas as consultas e relações são isoladas por organização. Exigir visibilidade da conversa e da entidade relacionada em leitura e edição.
- Não alterar `wa_conversations.deal_id`, nem regras atuais de acesso às conversas.
- Preservar associações para reativação. Sem novos pacotes.
- Produção e main ficam intactas até validação do preview. Nenhuma mensagem real de WhatsApp em testes.

---

### Task 1: Modelo, APIs, permissões e principal

**Files:**
- Create: migration via CLI `supabase migration new whatsapp_group_links` em `supabase/migrations/`.
- Create: `lib/whatsapp/group-links/{types,settings,service,access}.ts` (separar responsabilidades), testes colocados ao lado.
- Create: `app/api/settings/group-links/route.ts`, `app/api/whatsapp/group-links/route.ts`, `app/api/whatsapp/group-links/options/route.ts` e testes de rotas.
- Create: `supabase/tests/whatsapp_group_links.sql` com transação rollback.

**Interfaces:**
```ts
export type GroupLinkField = { whatsapp_group_id?: string | null };
export async function getGroupLinksEnabled(admin: SupabaseClient, organizationId: string): Promise<boolean>;
export async function getDealWhatsappGroupField(admin: SupabaseClient, organizationId: string, dealId: string): Promise<GroupLinkField>;
// settings.ts fornece primeiro helper; service.ts fornece segundo.
export type RelatedGroup = { id: string; provider: string; externalId: string; name: string; conversationId: string; isPrimary: boolean };
export type GroupLinkEntity = { id: string; name: string };
export type GroupLinksResponse = { enabled: boolean; groups: RelatedGroup[]; contacts: GroupLinkEntity[]; deals: GroupLinkEntity[]; whatsappGroupId?: string | null };
// GET /api/settings/group-links -> {enabled:boolean}; PATCH {enabled:boolean}, admin only.
// GET /api/whatsapp/group-links?conversationId=UUID | contactId=UUID | dealId=UUID (exactly one) -> GroupLinksResponse.
// POST /api/whatsapp/group-links {conversationId, entityType:'contact'|'deal', entityId, action:'link'|'unlink'|'set_primary'} -> {ok:true}.
// GET /api/whatsapp/group-links/options?conversationId=UUID&type=contact|deal&q=term -> {items:GroupLinkEntity[]} (limit 50, title/name search).
// SQL public.deal_whatsapp_group_field(p_organization_id uuid,p_deal_id uuid) returns jsonb: {} off, {whatsapp_group_id:null|string} on, service_role only.
```

- [ ] Inspect current provider values in wa_connections, contacts/deals permission patterns and requireOrgUser; reuse organization tab scoping and conversationAllowed. Contact visibility follows existing team lead access (fullAccess sees org contacts; otherwise at least one accessible nondeleted lead). Deal visibility uses visibleLead. Link/unlink needs both sides visible; principal choice also requires lead visible.
- [ ] Add focused tests before code, e.g.:
```ts
expect(await getDealWhatsappGroupField(adminOff, orgId, dealId)).toEqual({});
expect(await getDealWhatsappGroupField(adminUnlinked, orgId, dealId)).toEqual({whatsapp_group_id: null});
expect(await getDealWhatsappGroupField(adminLinked, orgId, dealId)).toEqual({whatsapp_group_id: '120363012345678901@g.us'});
```
Cover org mismatch, inaccessible conversation/entity, malformed/non-group IDs, disabled writes, nonadmin setting writes, link idempotence and primary semantics with actual SQL rollback assertions for constraints/RPC.
- [ ] Create tables `wa_group_entities` (organization_id, provider, external_id unique tuple), `wa_group_contact_links`, `wa_group_deal_links` with organization-scoped integrity, cascade, indexes, RLS enabled and revoked anon/authenticated grants. Group links carry is_primary for lead only. Use serialized per-lead RPC for link/unlink/set_primary with unique partial index. First link is primary only when no links existed. Unlink principal leaves remaining links nonprimary. Duplicate links don't promote. Registry comes from known group conversation + connection provider, full nonempty JID. Preserve provider-specific ID without normalization to phone digits.
- [ ] Implement bounded queries and delta endpoints, no overwrite of hidden links. Disabled GET returns only empty results plus enabled:false, with no field; disabled mutations return conflict/forbidden. Return friendly errors and fail closed on database errors. Resolve displayed group conversation through a visible connection; don't leak hidden group IDs/names. Field helper only for trusted server webhooks; UI field visibility also respects conversation access.
- [ ] Execute focused tests and typecheck, then commit. Controller applies additive migration and runs SQL rollback tests on staging after review. Do not mutate remote or deploy from worker.

### Task 2: Webhook contract and disable handling

**Files:**
- Modify: `lib/wa-agents/context.ts`, `lib/wa-agents/webhooks.ts`, webhook call sites `actions.ts`, `bots.ts`; `lib/webhooks/outbound.ts`.
- Create: `lib/webhooks/groupLinks.ts` and behavior tests.
- Create: CLI migration `whatsapp_group_link_webhooks`, replacing existing `notify_deal_stage_changed`, `notify_deal_created` and other deal-bearing SQL webhook builders when present; preserve unrelated behavior.
- Modify: webhook test API routes if they construct lead payloads.
- Tests: existing webhook/context suites plus new contract tests; SQL rollback verification added to `supabase/tests/whatsapp_group_links.sql`.

**Interfaces:** Consumes getGroupLinksEnabled and getDealWhatsappGroupField + SQL deal_whatsapp_group_field from Task 1. Produces optional `ContextDeal.whatsapp_group_id?: string|null`. Keep `buildWebhookPayload` synchronous if useful; delivery must refresh gating before rendering/sending.
```ts
export async function prepareGroupLinkWebhookPayload(admin: SupabaseClient, organizationId: string, payload: Record<string, unknown>, bodyTemplate?: string | null): Promise<unknown>;
// Fresh authoritative field for default deal object. Disabled: remove field and any template property depending on {{deal.whatsapp_group_id}}.
```

- [ ] Inventory real dispatch paths: pipeline pg_net calls, outbound retry stored event snapshots, agent hooks, custom actions, bot webhook blocks and webhook test endpoints. Read current trigger definitions/migrations; do not overwrite newer behavior. No new webhook transport.
- [ ] Write failing behavior tests with captured outgoing bodies covering enabled real ID, enabled no group null, disabled omission, stale payload, templates with renamed property/embedded variable/nested objects/arrays/whole deal injection, and reactivation. E.g. disabled template `{"target":"{{deal.whatsapp_group_id}}","name":"{{contact.name}}"}` results in `{name:'Maria'}`. Remove disabled variable value/property before generic rendering; do not rely on undefined becoming null. Remove legacy key recursively in snapshots. Existing unrelated templates must remain unchanged.
- [ ] Implement helper and wire immediate dispatch using current organization setting. Avoid copying broad blocks or changing template semantics for unrelated variables. On flag lookup failure do not send stale field. For templates producing raw text scrub disabled interpolations; do not retain a stale ID in fallback. Under active feature resolve real current principal ID. Empty lead means no invented lead object.
- [ ] SQL generators enrich payload deal JSON via helper before both insert and net.http_post. SQL helper has restricted privileges; no service secrets in migration. Keep webhook independent from whether deal update succeeds. Queued/in-flight network requests cannot be recalled; document exact boundary.
- [ ] Run focused webhook tests and typecheck, record paths audited and commit. Controller runs SQL checks on staging; worker no remote writes/deploys.

### Task 3: Interface, selectors and integration validation

**Files:**
- Create: `features/group-links/{api,useGroupLinks,GroupLinksSettings,GroupRelationsPanel,RelatedGroups}.tsx` (use .ts for pure API/hooks as appropriate) and focused component tests.
- Modify: `features/settings/CrmSettings.tsx`, `features/chats/ChatsPage.tsx`, `features/contacts/components/ContactFormModal.tsx`, `features/deals/lead/LeadPropertiesPanel.tsx` (shared by DealDetailModal and LeadDetailsAside; verify both consumers without duplicating integration).
- Modify: `features/boards/automations/stageAutomationModel.ts`, `StageActionModal.tsx`, `lib/wa-agents/catalog.ts`, and actual agent/bot variable selector consumers for conditional field.
- Create: `docs/whatsapp-group-links.md` with user flow and payload mapping to AJ Ops.

**Interfaces:** Consumes Task 1 API DTOs and Task 2 optional variable. Query keys organization-scoped. No duplicate deal/contact caches. Link queries can have their own canonical key per relationship target; mutations update/refetch those keys for affected conversation/contact/deal. GET defaults fail closed. Feature settings stale state must invalidate on same-tab change and refresh on focus.

- [ ] Read existing UI patterns and React best practice skill. Build opt-in setting under CRM Recursos opcionais, administrator only. Explain linking sales/customer groups and preservation when disabled in concise Portuguese. Keep existing WhatsApp groups switch separate; suggest enabling it if groups unavailable.
- [ ] Implement group relation panel with searchable contact/lead choices, independent link/unlink per item, loading/error/empty states. Keep group as own chat row; multiple contacts/leads possible; no implicit linking all group members. Conserve mobile space using existing drawer/disclosure pattern.
- [ ] Add RelatedGroups to active contact and lead screens. Each group opens `/chats?conversation=<id>` through existing route. Lead shows readonly ID plus copy action and explicit principal choice for any nonprincipal linked group (including one remaining after removing the former principal); no editable text ID. Example integration:
```tsx
<RelatedGroups entityType="deal" entityId={deal.id} />
<GroupRelationsPanel conversationId={selected.conversationId} />
```
When disabled return null for these sections, including errors if flag unavailable. Avoid showing empty sections while setting unresolved.
- [ ] Add `{{deal.whatsapp_group_id}}` only to feature-enabled selectors in pipeline, agents, bots. Preserve static base catalog consumers by composing conditional additions rather than making catalog globally visible. Existing saved templates remain readable/editable with warning/copy if appropriate, but no stale field suggestion off. API gating remains authoritative.
- [ ] Add component tests for feature off hidden, activation reveals field, first/explicit principal selection, multiple contacts, errors, disabling hides then reactivation restores, and conditional selectors. Test actual interaction instead of implementation assertions.
- [ ] Document default payload fragment and custom mapping `{ "whatsappGroupId": "{{deal.whatsapp_group_id}}" }`, null/off semantics, separate optional toggle, access limits, no AJ Ops receiver deployed. Run focused UI tests, lint, typecheck and full Vitest once on final branch; build `next build --webpack` if shared node_modules symlink prevents Turbopack. Fix failures attributable to feature; report baseline failures with evidence. Commit.

## Controller delivery checklist
- [ ] Review each task with independent agent and fix required findings.
- [ ] Apply migrations only to staging project mggvzlmquzqcloprxmoe, execute rollback SQL constraints/contracts tests and advisors; compare baseline notices.
- [ ] Browser verify group → multiple links → lead ID/principal → disable/enable and separate chat rows, desktop/mobile. Use staging fixtures and mock outbound transport, no real WhatsApp messages.
- [ ] Whole-branch review and focused fixes, then publish independent preview with branch-specific staging environment, preserving main/production. Give Samuel link and actual validation limits.
