# Header and Dropdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved integrated header and consistent dropdowns throughout active CRM screens.
**Architecture:** Shared Radix-based selection controls and presentation-only header slots. Existing query ownership and mutations remain authoritative.
**Tech Stack:** React 19, Next 16, TypeScript, Radix, Tailwind, Vitest.
**Spec:** `docs/superpowers/specs/2026-09-29-header-dropdowns-quotes-design.md`

## Global Constraints

- No new dependencies, network queries or subscriptions for dropdowns/header.
- Preserve empty values, disabled options, groups, form registration, accessibility, dark mode and modal focus.
- Preserve mounted chat/composers and drafts, responsive minimums and “Deseja mudar lead de funil?” confirmation.
- Use existing Rubik/colors. Do not apply generated-image changes to messages, composer or navigation.
- No business writes or WhatsApp sends in real-data verification. Main authorized; staging untouched.

## Task 1: Shared selection controls and active-screen migration

**Files:** `components/ui/FormControls.tsx`, `components/ui/FormField.tsx`, new selection helpers/tests as needed; all native select call sites under `features`, and `app/(admin)/admin/page.tsx`, except `features/chats/ChatsPage.tsx` owned by Task 2. Exclude `app/(protected)/labs` and document any proven unused files. Do not modify DealWhatsAppChat.tsx.

**Interfaces:** Preserve existing `FormSelect({label,value,onChange,options,placeholder,disabled})` callers. Extend options with disabled/group support and optional compact/searchable presentation. If a JSX adapter is chosen, export `NativeSelect` from `components/ui/NativeSelect.tsx`, supporting existing single-select native props/children with identical onChange values; explicitly test form and focus contracts. Send the exact interface to Task 2 before it migrates Chats.

- [ ] Inventory current native select callers and imports to distinguish active paths. Record each converted/excluded file.
- [ ] Add RED tests for an empty selectable value, disabled option, long/grouped options, search, Escape/focus, form serialization and form-registration validation. Example expectations:
```tsx
await user.click(screen.getByRole('combobox', {name: 'Produto'}));
await user.click(screen.getByRole('option', {name: 'Sem produto'}));
expect(onChange).toHaveBeenLastCalledWith('');
```
```tsx
await user.keyboard('{Escape}');
expect(screen.getByRole('combobox', {name: 'Produto'})).toHaveFocus();
expect(fetchSpy).not.toHaveBeenCalled();
```
- [ ] Implement shared behavior on installed Radix primitives; use a tested empty-value sentinel internally if required. Closed controls do not mount huge option lists. Search must not break typeahead/focus or select a disabled option.
- [ ] Migrate same-shaped selectors in one batch, preserving each handler, value, empty semantics, labels, permissions and disabled conditions. Avoid rewriting unrelated logic. Products and long lists use local search.
- [ ] Run focused tests/typecheck/changed lint, inspect diff for changed business logic, commit only owned files. Write exact evidence and exclusions in report.

## Task 2: Integrated header

**Files:** `features/chats/ChatsPage.tsx`, a focused new `features/chats/ChatCrmHeader.tsx`, `features/whatsapp/DealWhatsAppChat.tsx` header/props only, related tests.

**Interfaces:** Add optional `headerActions?: React.ReactNode` and `headerContext?: React.ReactNode` to DealWhatsAppChat, outside ChatTimelineProps so unlinked/group conversations work. HeaderActions appears beside search; headerContext below identity within one cohesive header. Board/timeline headerExtra/headerEnd remain compatible. No new query ownership. Consume Task 1's agreed shared selection API for four Chats selectors.

- [ ] Add RED tests for metadata order, nonduplicated contact identity, Properties action, no-lead/error/group variants, no owner/stage duplication with panel open and no remount on header changes.
```tsx
expect(screen.getByRole('button', {name: 'Mostrar propriedades do lead'})).toHaveAttribute('aria-expanded','false');
// After panel toggle, the same textarea node and draft remain.
expect(screen.getByPlaceholderText('Escreva uma mensagem...')).toBe(composer);
expect(composer).toHaveValue('rascunho');
```
- [ ] Move current CRM controls into ChatCrmHeader using existing handlers/queries; linked lead selector then open-lead icon, stage, readonly owner and tags. Tag removal belongs inside existing management UI, not a resting chip X. Keep accessible labels for icon actions.
- [ ] Render headerContext inside DealWhatsAppChat after identity row. Add min-width/wrapping/overflow rules for 390 px and long labels; Properties stays reachable and existing mobile drawer works.
- [ ] Migrate remaining Chats selects using Task 1 API. Preserve group member/invite/search behavior, lead creation/link modes and exact funnel confirmation.
- [ ] Focused tests/typecheck/lint, review only owned diff, commit. Report usage states and exact test evidence.

## Controller acceptance

- [ ] Preserve/build reference; measure before/after on same host and production.
- [ ] Task reviews, whole-branch review with quotes plan, browser acceptance and full suite/build.
- [ ] Publish main and webhook after both plans pass; verify live and clean temporary sessions.
