# Shared lead properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved expandable lead panel, internal notes in Chats, automatic navigation collapse, and explicit cross-funnel confirmation.

**Architecture:** Extract the board's property editing into one reusable panel. A paginated lead history reader and conversation controller serve both screens. The existing stage control holds a pending cross-funnel selection before invoking the existing movement mutation.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase RLS, TanStack Query, Tailwind, Vitest and React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-chat-lead-properties-design.md` (approved by Samuel; final title correction included).

## Global Constraints

- Modal title: **Deseja mudar lead de funil?**
- A primeira página do histórico fica limitada a 50 itens de linha do tempo.
- Consultas por organização e lead, canceláveis ao trocar a seleção.
- Reutilizar os caches canônicos documentados em `AGENTS.md`: `DEALS_VIEW_KEY` para lead enriquecido; listas canônicas para mutações das outras entidades.
- Uma mesma implementação de propriedades atende Chats e card. Proposta 3: seções expansíveis.
- Preservar os temas claro e escuro, navegação por teclado, rótulos acessíveis e retorno de foco ao fechar o painel.
- Reorganizar o painel não pode remontar a instância da conversa, apagar rascunhos ou deslocar a rolagem do histórico.
- Nenhum envio de WhatsApp faz parte da verificação; staging permanece intacto.
- No new runtime dependency. Publication to main is authorized after verification; do not ask again.
- Every implementation task must report exact tests, outcomes, commits, and any deviations. No worker spawns subagents. Only stage owned files.

## File boundaries and order

Task 1 owns stage confirmation. Task 2 owns paginated history plus a reusable conversation hook. Task 3 extracts properties and integrates both shared components in the board. Task 4 adds them to Chats and manages sidebar behavior. Task 5 verifies integration, measures, fixes findings, and publishes. Only one implementation worker runs at a time; the controller measures the current release separately.

### Task 1: Confirm cross-funnel selections

**Files:** Modify `features/deals/lead/DealStageControl.tsx`, `features/deals/lead/StageCascadePicker.tsx` only if necessary for busy/focus behavior. Create `features/deals/lead/DealStageControl.test.tsx`. Reuse `components/ConfirmModal.tsx`, extending its optional pending interface only when needed.

**Interfaces:** Preserve `DealStageControl({deal, size?, align?})` and `StageCascadePicker` public props. Produce local pending state `{dealId, sourceBoardId, sourceStageId, targetBoardId, targetStageId}`. Existing `useMoveDeal().mutateAsync` remains the sole movement path.

- [ ] Write behavior tests with mocked movement boundary and real picker/modal interaction. Core assertions:

```tsx
fireEvent.click(screen.getByRole('option', { name: /Etapa destino/ }));
expect(screen.getByRole('alertdialog')).toHaveTextContent('Deseja mudar lead de funil?');
expect(mutateAsync).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
expect(mutateAsync).not.toHaveBeenCalled();
```

Also cover browsing another funnel without selection, same-funnel movement, confirm once/double click, stale source/deal/destination, loss reason cancellation, permission denial, server failure and keyboard cancellation/focus return.

- [ ] Run `npm run test:run -- features/deals/lead/DealStageControl.test.tsx features/deals/lead/StageCascadePicker.test.tsx`; capture failure before implementation.
- [ ] Implement pending selection before loss handling/mutation:

```ts
if (board.id !== deal.boardId) {
  setPendingMove({ dealId: deal.id, sourceBoardId: deal.boardId, sourceStageId: deal.status,
    targetBoardId: board.id, targetStageId: stage.id });
  return;
}
```

Resolve the pending IDs against current props/boards on confirmation; cancel if source or target no longer matches. Render source/destination labels and known gain/loss/reopen/automation effects, buttons Cancelar and Confirmar mudança de funil. Preserve the lost-reason workflow and lock synchronous duplicate submissions with a ref. Cancel must not invoke mutation, optimistic updates, history or automation.

- [ ] Run the tests, typecheck and eslint for changed files. Commit `feat: confirm cross-funnel lead transfers`.

### Task 2: Shared paginated lead history and CRM conversation controller

**Files:** Create `app/api/deals/[dealId]/timeline/route.ts`, `features/deals/lead/timelinePage.ts`, `features/deals/lead/useLeadHistory.ts`, `features/deals/lead/useLeadConversation.tsx` and colocated tests. Reuse `LeadTimeline.tsx`, `LeadComposers.tsx`, `PendingActivitiesStrip.tsx`. Modify `LeadComposers.tsx` only to prevent stale asynchronous saves clearing another lead's draft. Modify realtime/mutation integration files only for targeted read-view invalidation. Preserve old history route for other consumers.

**Interfaces:**

```ts
type LeadHistoryPage = {
  history: DealHistory;
  activities: Activity[];
  nextCursor: string | null;
};
// Canonical mutations stay in existing contexts; this is a shared read projection.
const leadHistoryKey = (orgId: string, dealId: string) => ['leadHistory', orgId, dealId] as const;
// Hook result: timeline can be spread with screen-specific headerExtra/headerEnd.
type LeadConversationResult = {
  timeline: ChatTimelineProps;
  dialogs: React.ReactNode;
  openActivity: (activity: Activity) => void;
  refresh: () => Promise<unknown>;
};
function useLeadConversation(input: {
  deal: Deal | DealView | null | undefined;
  enabled?: boolean;
}): LeadConversationResult;
```

- [ ] Write cursor/unit and endpoint authorization tests. Include these exact invariants with real normalization/cursor code, mocking only network/database boundaries:

```ts
expect(page.activities.length + page.history.events.length + page.history.apiNotes.length).toBeLessThanOrEqual(50);
expect(new Set(allPages.map(item => `${item.source}:${item.id}`)).size).toBe(allPages.length);
expect(unauthorizedResponse.status).toBe(404);
expect(abortedSignal.aborted).toBe(true);
```

Test tied timestamps across all three origins, old notes, soft deletion, bad cursor, foreign org, RLS-hidden lead, response failure (not empty history), delayed response after org switch, note save/edit/delete, realtime refresh, API notes read-only and no WhatsApp send calls.

- [ ] Run the new tests before implementation and capture failure.
- [ ] Implement a user-authorized, organization-filtered endpoint with a stable descending composite cursor. Query up to 51 per source, merge by timestamp/source/id and return 50 total with nextCursor from the last returned item. Return activity bodies plus author metadata, events and API notes in compatible `DealHistory` form. Use user-scoped RLS for activity reads; any admin name resolution occurs only for authorized IDs. No all-organization activity read. Preserve legacy status-change cutoff semantics in `LeadTimeline`.
- [ ] Implement a shared infinite read query using `AbortSignal`, organization+deal key, 30-second freshness and focus/reconnect revalidation. Patch/invalidate this projection from canonical mutations/realtime rather than maintaining a second optimistic entity cache. Subscription count stays bounded, query only active lead, no whole-history 10-second polling. If database event publication cannot deliver a source, use a bounded first-page refresh only while visible and document it.
- [ ] Implement controller: reuse canonical activity mutations, note/activity composers, delete confirmation, timeline renderer and pending strip. Drafts keyed by org+lead survive mode changes, panel toggles and failures; stale saves cannot clear another selection. Include loading/error/retry and older-history controls. Extend `ChatTimelineProps` with an optional history-prefix slot if necessary so older-history loading preserves the scroller's anchor; do not remount chat.
- [ ] Run focused tests, typecheck and changed-file lint. Commit `feat: share paginated lead notes and timeline`.

### Task 3: Extract expandable properties and adopt shared history in board

**Files:** Create `features/deals/lead/LeadPropertiesPanel.tsx`, focused property subcomponents as needed, and `LeadPropertiesPanel.test.tsx`. Modify `features/boards/components/Modals/DealDetailModal.tsx`. Use the shared controller from Task 2 and retain existing AI surface and template context.

**Interfaces:**

```ts
type LeadPropertiesPanelProps = {
  deal: Deal | DealView;
  contact?: Contact | null;
  onClose?: () => void;
  onDeleted?: () => void;
  onExpand?: () => void;
  side?: 'left' | 'right';
};
```

Data services, permissions, org members, definitions and canonical mutations remain shared through existing hooks/contexts. The panel itself fetches no global activity list and contains no WhatsApp instance.

- [ ] Add tests for initial Negócio/Contato expansion, collapsed custom fields/products/UTMs/details, independent sections, title/value/description validation and failure retention, canonical mutation calls, read-only permissions, deletion confirmation and switching lead while a draft/save is pending. Assert one visible field per property.

```tsx
expect(screen.getByRole('button', { name: /Negócio/ })).toHaveAttribute('aria-expanded', 'true');
expect(screen.getByRole('button', { name: /Campos personalizados/ })).toHaveAttribute('aria-expanded', 'false');
expect(updateDeal).not.toHaveBeenCalled(); // expanding a section does not save
```

- [ ] Run tests to record failure. Extract the existing property behaviors; preserve tags, custom-field types/groups/hidden groups, product catalog and custom items with editable quantity/price, contact and company actions, UTMs, alert acknowledgement, priority and probability. Keep title/status/tags/stage in the fixed header, destructive action in options. Empty description becomes a one-line action. Keep dark theme and keyboard focus.
- [ ] Replace the board's inline property markup with `LeadPropertiesPanel`. Remove superseded local editor code instead of maintaining two implementations. Adopt `useLeadConversation` for its timeline, preserving owner/AI/close headers, pending activities and schedule hints. Ensure the same chat instance remains mounted across panel changes.
- [ ] Run focused tests, existing lead/chat tests, typecheck and changed-file lint. Commit `refactor: share expandable lead properties`.

### Task 4: Integrate right panel, notes and navigation collapse in Chats

**Files:** Modify `features/chats/ChatsPage.tsx`; create `features/chats/LeadDetailsAside.tsx`, `hooks/useConversationSidebar.ts`, and colocated tests. Reuse Task 2 and 3 components; modify `context/CRMContext.tsx` only if explicit navigation-origin tracking is necessary.

**Interfaces:** `LeadDetailsAside` receives the same resolved selected lead and contact as the conversation and contains `LeadPropertiesPanel`. `useConversationSidebar(selectionKey: string | null)` uses existing sidebar state, remembers entry preference, respects manual expansion, restores on exit when not overridden.

- [ ] Tests: selecting a different chat collapses main nav; receiving data for the same chat doesn't; manual reopen is respected; conversation list remains; restore on exit; groups/no lead don't display stale properties; narrow layout is an accessible drawer; note timeline uses the linked lead; no extra chat mount or message draft loss when toggling details.

```tsx
rerender(<Harness selected="conversation-a" update={2} />);
expect(setSidebarCollapsed).toHaveBeenCalledTimes(1);
expect(screen.getByRole('textbox', { name: /mensagem/i })).toHaveValue('rascunho');
```

- [ ] Run tests before code. Integrate shared timeline and render dialogs once. Put the properties aside to the right of chat; use approximately 360px only when chat retains at least 480px, otherwise a drawer. Reuse existing conversation list resize constraints. Remove duplicate stage controls from the chat header when properties are visible, while keeping lead selection and labels discoverable. Keep existing group, sender, owner, templates, contact linking and realtime flows.
- [ ] Run focused tests, all chat/group/link regression tests, typecheck and changed-file lint. Commit `feat: add lead workspace to chats`.

### Task 5: Review integration, compare performance and release

**Files:** Create `docs/verification/2026-09-28-chat-lead-properties.md`; save sanitized metric summaries and UI evidence. Fix only concrete issues found by tests/review. Use `scripts/` for any committed repeatable measurement helper; auth/session data stay in private temporary files.

**Interfaces:** Baseline and candidate share measurement definitions: selection to message paragraph plus compositor; 10s request window; 10 cold and 10 warm runs, Chromium 1600×1000, same account/org/conversation and network. Root measurement script is `/Users/samuelmacario/aj-workspace/codex-claude/.tmp/crm-link-release/measure-properties.cjs`.

- [ ] Read baseline output and record p50/p90/range, bytes and requests before product implementation. Derive absolute regression budgets from observed range and document them in verification report. Data bytes are CDP encoded response sizes, not JSON length. Record cached/zero-byte responses and static assets separately.
- [ ] Run complete test suite, typecheck, build and lint; compare known baseline failures from `docs/verification/2026-09-28-lead-contact-reliability.md`. Never disguise a new failure as an old one.
- [ ] Verify candidate visually with agent-browser: 1600px, 1280px and 390px, light/dark, both screens, modal cancellation, notes with permission, no-link/group. Take screenshots and inspect images. No client messages and no real lead movement.
- [ ] Repeat metric runs against an optimized production build, with same data/account/network and distinguish hosting differences. Investigate repeated regression. Inspect requests to prove toggling loaded sections sends none and only active lead history is requested. Test rapid switch/delayed response, long history and note/edit errors using isolated fixtures or unit integration boundaries.
- [ ] Conduct whole-branch review, fix findings with focused regression tests, then publish to main using exact reviewed commit. Observe deployment success and verify live build, UI, reads and confirmation cancellation. Revoke temporary sessions/remove private files and restore any changed organization default.
- [ ] Final report states what shipped, test results, measured values/limitations and commit. Never claim zero bugs or zero performance cost.

## Self-review coverage

All spec sections map to tasks: panel 3/4, confirmation 1, notes and link isolation 2/4, nav 4, data/cache 2, measurement 5, verification 1–5, publication 5. Same-files sequence is intentional: Task 2 creates interfaces consumed by Tasks 3/4; Task 3 owns board only; Task 4 owns Chats only. Existing published link fixes remain baseline and are not reimplemented.
